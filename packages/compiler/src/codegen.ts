// Sigil compiler back end: AST -> JavaScript program + constants.
//
// The compiler transforms model output before any client runs it:
//   - markup becomes plain function calls (__sigil.jsx), so the client needs
//     no Sigil parser at all;
//   - static text is moved into a constants table (streaming text growth then
//     only touches data, not the program);
//   - expressions are wrapped in __sigilSafe so one throwing expression
//     removes one element instead of aborting the whole render;
//   - every useState gets a stable key so state survives recompiles;
//   - tags/props are validated against the component catalog.

import type { Diagnostic, Prop, Seg, SigNode } from './parser.ts'

export interface CompileOptions {
  /** allowed tag names; unknown tags are unwrapped with a diagnostic */
  catalog?: ReadonlySet<string>
  /** parser diagnostics to carry over into the result */
  diagnostics?: Diagnostic[]
}

export interface CompileResult {
  code: string
  constants: Record<string, string>
  diagnostics: Diagnostic[]
}

export function compile(nodes: SigNode[], opts: CompileOptions = {}): CompileResult {
  const diagnostics: Diagnostic[] = [...(opts.diagnostics ?? [])]
  const catalog = opts.catalog ?? null
  const constants: Record<string, string> = {}
  let constSeq = 0
  let stateSeq = 0

  const constRef = (s: string): string => {
    const k = String(constSeq++)
    constants[k] = s
    return `__sigilConstants[${JSON.stringify(k)}]`
  }

  // ---- hoisting: {@body} statements execute at component top level
  const bodyStmts: string[] = []
  const hoist = (list: SigNode[]): SigNode[] => {
    const out: SigNode[] = []
    for (const node of list) {
      if (node.kind === 'body') {
        bodyStmts.push(injectStateKeys(node.code))
        continue
      }
      if (node.kind === 'el') node.children = hoist(node.children)
      if (node.kind === 'if') node.branches.forEach(b => (b.children = hoist(b.children)))
      if (node.kind === 'each') node.children = hoist(node.children)
      out.push(node)
    }
    return out
  }
  const hoisted = hoist(nodes)

  // Give every Sigil.useState(...) a stable key: useState(init) ->
  // useState(init, { key: "s0" })
  function injectStateKeys(code: string): string {
    let out = ''
    let i = 0
    for (;;) {
      const at = code.indexOf('Sigil.useState(', i)
      if (at < 0) {
        out += code.slice(i)
        break
      }
      out += code.slice(i, at)
      const open = at + 'Sigil.useState'.length // at the '('
      let depth = 0
      let j = open
      for (; j < code.length; j++) {
        if (code[j] === '(') depth++
        else if (code[j] === ')') {
          depth--
          if (depth === 0) break
        }
      }
      if (j >= code.length) {
        out += code.slice(at)
        break
      }
      const args = code.slice(open + 1, j)
      if (/key\s*:/.test(args)) {
        out += code.slice(at, j + 1)
      } else {
        out += `Sigil.useState(${args}, { key: "s${stateSeq++}" })`
      }
      i = j + 1
    }
    return out
  }

  // ---- codegen
  const TEXTLIKE = new Set(['title', 'text', 'caption', 'chip', 'bold'])

  function segsCode(segs: Seg[]): string {
    return segs
      .map(s => {
        if (s.t === 'str') return s.v ? constRef(s.v) : null
        if (s.t === 'expr') return `__sigilSafe(() => (${s.code}), null)`
        const inner = segsCode(s.segs)
        return `__sigil.jsx("bold", null${inner ? ', ' + inner : ''})`
      })
      .filter(Boolean)
      .join(', ')
  }

  function propsCode(props: Prop[]): string {
    const entries: string[] = []
    for (const p of props) {
      const key = JSON.stringify(p.name)
      if (p.kind === 'bool') entries.push(`${key}: true`)
      else if (p.kind === 'str') entries.push(`${key}: ${JSON.stringify(p.v)}`)
      else if (p.kind === 'bare') entries.push(`${key}: ${/^-?\d+(\.\d+)?$/.test(p.v) ? p.v : JSON.stringify(p.v)}`)
      else if (p.kind === 'expr') {
        if (/^on[A-Z]/.test(p.name)) {
          entries.push(`${key}: (${p.v})`) // event handler: a function value
        } else {
          entries.push(`${key}: __sigilSafe(() => (${p.v}), undefined)`)
        }
      }
    }
    return `{${entries.join(', ')}}`
  }

  function childrenCode(list: SigNode[], parentTag?: string): string {
    return list
      .map(n => {
        // Inside text-like components, inline the segments instead of nesting
        // another <text> wrapper (matches how Markdown compiles into the tree).
        if (parentTag && TEXTLIKE.has(parentTag) && n.kind === 'text') {
          return segsCode(n.segs)
        }
        return gen(n)
      })
      .filter(Boolean)
      .join(', ')
  }

  function gen(node: SigNode): string | null {
    switch (node.kind) {
      case 'text': {
        const inner = segsCode(node.segs)
        if (!inner) return null
        return `__sigil.jsx("text", null, ${inner})`
      }
      case 'title': {
        const inner = segsCode(node.segs)
        return `__sigil.jsx("title", { size: ${JSON.stringify(node.size)} }${inner ? ', ' + inner : ''})`
      }
      case 'expr':
        return `__sigilSafe(() => (${node.code}), null)`
      case 'el': {
        if (catalog && !catalog.has(node.tag)) {
          diagnostics.push({ code: 'unknown_tag', name: node.tag })
          return childrenCode(node.children) || null // unwrap: keep children
        }
        const kids = childrenCode(node.children, node.tag)
        return `__sigil.jsx(${JSON.stringify(node.tag)}, ${propsCode(node.props)}${kids ? ', ' + kids : ''})`
      }
      case 'if': {
        // nested ternary chain
        let out = 'null'
        for (let k = node.branches.length - 1; k >= 0; k--) {
          const b = node.branches[k]
          const kids = childrenCode(b.children) || 'null'
          out = b.test ? `(__sigilSafe(() => (${b.test}), false) ? (${kids}) : ${out})` : `(${kids})`
        }
        return out
      }
      case 'each': {
        const kids = childrenCode(node.children)
        const idx = node.index
        return (
          `__sigilSafe(() => (${node.list}), []).map((${node.item}, ${idx}) => ` +
          `__sigil.jsx(__sigil.Fragment, { key: ${idx} }${kids ? ', ' + kids : ''}))`
        )
      }
      default:
        return null
    }
  }

  const children = childrenCode(hoisted)
  // `return` makes the program's value (the root element) visible to the
  // runner's `new Function` evaluation.
  const code =
    `return Sigil.render(__sigil.jsx(function __sigilBody() {\n` +
    `  const __sigilConstants = Sigil.useConstants();\n` +
    bodyStmts.map(s => `  ${s}\n`).join('') +
    `  return __sigil.jsx(__sigil.Fragment, null${children ? ', ' + children : ''});\n` +
    `}, { key: "body:0" }));`

  return { code, constants, diagnostics }
}
