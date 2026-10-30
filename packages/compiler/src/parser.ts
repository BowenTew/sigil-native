// Sigil parser.
//
// Parses the streaming-friendly language: Markdown prose + JSX-like component
// tags from a fixed catalog + JavaScript for local state and logic.
//
// Design goals:
//   1. Tolerant of half-written input: the source is cut at its last complete
//      construct; unfinished tags/expressions are dropped with a diagnostic,
//      unclosed elements/blocks are auto-closed.
//   2. Line-oriented statements ({@body ...}) and auto-closable tags mean any
//      prefix of a response can be compiled while it streams.

export interface Diagnostic {
  code: string
  name?: string
}

export type Seg = { t: 'str'; v: string } | { t: 'expr'; code: string } | { t: 'bold'; segs: Seg[] }

export type Prop =
  | { name: string; kind: 'str'; v: string }
  | { name: string; kind: 'expr'; v: string }
  | { name: string; kind: 'bare'; v: string }
  | { name: string; kind: 'bool' }

export interface IfBranch {
  /** null => final else */
  test: string | null
  children: SigNode[]
}

export type SigNode =
  | { kind: 'text'; segs: Seg[] }
  | { kind: 'title'; size: 'lg' | 'md'; segs: Seg[] }
  | { kind: 'expr'; code: string }
  | { kind: 'el'; tag: string; props: Prop[]; children: SigNode[] }
  | { kind: 'if'; branches: IfBranch[] }
  | { kind: 'each'; list: string; item: string; index: string; children: SigNode[] }
  | { kind: 'body'; code: string }

export interface ParseResult {
  nodes: SigNode[]
  diagnostics: Diagnostic[]
}

// ---------------------------------------------------------------- tokens

type Token =
  | { t: 'text'; v: string }
  | { t: 'title'; level: number; v: string }
  | { t: 'open'; name: string; props: Prop[]; selfClosing: boolean }
  | { t: 'close'; name: string }
  | { t: 'body'; code: string }
  | { t: 'expr'; code: string }
  | { t: 'if'; code: string }
  | { t: 'else'; code: string | null }
  | { t: '/if' }
  | { t: 'each'; code: string }
  | { t: '/each' }

export function parseSigil(source: string): ParseResult {
  const diagnostics: Diagnostic[] = []
  const tokens = tokenize(source, diagnostics)
  const nodes = buildTree(tokens, diagnostics)
  return { nodes, diagnostics }
}

function tokenize(src: string, diags: Diagnostic[]): Token[] {
  const tokens: Token[] = []
  const n = src.length
  let i = 0
  let lineStart = true
  let textBuf = ''

  const flushText = () => {
    if (textBuf) {
      tokens.push({ t: 'text', v: textBuf })
      textBuf = ''
    }
  }

  while (i < n) {
    const c = src[i]

    if (lineStart) {
      const h = /^(#{2,3}) /.exec(src.slice(i, i + 4))
      if (h) {
        flushText()
        const level = h[1].length
        i += h[0].length
        let j = src.indexOf('\n', i)
        if (j < 0) j = n
        tokens.push({ t: 'title', level, v: src.slice(i, j) })
        i = j
        lineStart = true
        continue
      }
    }

    if (c === '<') {
      const j = findTagEnd(src, i)
      if (j < 0) {
        diags.push({ code: 'unterminated_tag' })
        break // drop the partial tag and everything after it
      }
      flushText()
      tokens.push(parseTag(src.slice(i + 1, j), diags))
      i = j + 1
      lineStart = false
      continue
    }

    if (c === '{') {
      const j = matchBrace(src, i)
      if (j < 0) {
        diags.push({ code: 'unterminated_expr' })
        break // drop the partial expression and everything after it
      }
      flushText()
      tokens.push(classifyExpr(src.slice(i + 1, j)))
      i = j + 1
      lineStart = false
      continue
    }

    if (c === '\n') {
      flushText()
      i++
      lineStart = true
      continue
    }

    textBuf += c
    i++
    lineStart = false
  }
  flushText()
  // Drop whitespace-only text tokens between structural tokens (they are just
  // source formatting between tags), but keep meaningful inline spaces.
  const tagish = (x: Token | undefined) =>
    !!x &&
    (x.t === 'open' ||
      x.t === 'close' ||
      x.t === 'title' ||
      x.t === 'body' ||
      x.t === 'if' ||
      x.t === 'else' ||
      x.t === '/if' ||
      x.t === 'each' ||
      x.t === '/each')
  return tokens.filter((t, i) => {
    if (t.t !== 'text' || t.v.trim()) return true
    return !(tagish(tokens[i - 1]) && tagish(tokens[i + 1]))
  })
}

// Find the `>` that ends a tag, skipping quoted strings and balanced {...}
// regions (prop expressions may contain `>`, e.g. {a > b}).
function findTagEnd(src: string, i: number): number {
  let quote: string | null = null
  let depth = 0
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
    } else if (c === '>' && depth === 0) {
      return j
    }
  }
  return -1
}

// Match the `}` closing the `{` at index i. Returns -1 when incomplete.
export function matchBrace(src: string, i: number): number {
  let depth = 0
  let quote: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function parseTag(inner: string, diags: Diagnostic[]): Token {
  let s = inner
  let closing = false
  let selfClosing = false
  if (s.startsWith('/')) {
    closing = true
    s = s.slice(1)
  }
  if (!closing && s.endsWith('/')) {
    selfClosing = true
    s = s.slice(0, -1)
  }
  const m = /^\s*([A-Za-z][\w.-]*)/.exec(s)
  if (!m) {
    diags.push({ code: 'invalid_tag' })
    return { t: 'text', v: '' }
  }
  const name = m[1]
  const props: Prop[] = closing ? [] : scanProps(s.slice(m[0].length), diags)
  if (closing) return { t: 'close', name }
  return { t: 'open', name, props, selfClosing }
}

// Scan `border padding={3} gap={2} onChange={fn} value="x"`.
function scanProps(s: string, diags: Diagnostic[]): Prop[] {
  const props: Prop[] = []
  let i = 0
  const n = s.length
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++
    if (i >= n) break
    let j = i
    while (j < n && !/[\s=]/.test(s[j])) j++
    const name = s.slice(i, j)
    i = j
    while (i < n && /\s/.test(s[i])) i++
    if (s[i] !== '=') {
      props.push({ name, kind: 'bool' })
      continue
    }
    i++ // skip =
    while (i < n && /\s/.test(s[i])) i++
    const c = s[i]
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1)
      if (end < 0) {
        diags.push({ code: 'unterminated_prop', name })
        props.push({ name, kind: 'str', v: s.slice(i + 1) })
        break
      }
      props.push({ name, kind: 'str', v: s.slice(i + 1, end) })
      i = end + 1
    } else if (c === '{') {
      const end = matchBrace(s, i)
      if (end < 0) {
        diags.push({ code: 'unterminated_prop', name })
        break
      }
      props.push({ name, kind: 'expr', v: s.slice(i + 1, end).trim() })
      i = end + 1
    } else {
      let k = i
      while (k < n && !/\s/.test(s[k])) k++
      props.push({ name, kind: 'bare', v: s.slice(i, k) })
      i = k
    }
  }
  return props
}

function classifyExpr(raw: string): Token {
  const code = raw.trim()
  if (code.startsWith('@body')) return { t: 'body', code: code.slice(5).trim() }
  if (code.startsWith('#if')) return { t: 'if', code: code.slice(3).trim() }
  if (code.startsWith(':else if')) return { t: 'else', code: code.slice(8).trim() }
  if (code.startsWith(':else')) return { t: 'else', code: null }
  if (code === '/if') return { t: '/if' }
  if (code.startsWith('#each')) return { t: 'each', code: code.slice(5).trim() }
  if (code === '/each') return { t: '/each' }
  return { t: 'expr', code }
}

// ---------------------------------------------------------------- tree builder

interface Frame {
  type: 'root' | 'el' | 'if' | 'each'
  node: SigNode | { kind: 'root'; children: SigNode[] }
  children: SigNode[]
  branch?: IfBranch
}

function buildTree(tokens: Token[], diags: Diagnostic[]): SigNode[] {
  const root = { kind: 'root' as const, children: [] as SigNode[] }
  const stack: Frame[] = [{ type: 'root', node: root, children: root.children }]
  // Pending inline run: adjacent text/expr tokens merge into one text node so
  // that `**bold with {expr} inside**` parses correctly across token borders.
  let inlineBuf = ''

  const top = () => stack[stack.length - 1]
  const flushInline = () => {
    if (!inlineBuf) return
    top().children.push({ kind: 'text', segs: parseInline(inlineBuf) })
    inlineBuf = ''
  }

  for (const tok of tokens) {
    if (tok.t === 'text') {
      inlineBuf += tok.v
      continue
    }
    if (tok.t === 'expr') {
      inlineBuf += `{${tok.code}}`
      continue
    }
    flushInline()

    switch (tok.t) {
      case 'title':
        top().children.push({
          kind: 'title',
          size: tok.level === 2 ? 'lg' : 'md',
          segs: parseInline(tok.v),
        })
        break
      case 'body':
        top().children.push({ kind: 'body', code: tok.code })
        break
      case 'if': {
        const node: SigNode = { kind: 'if', branches: [{ test: tok.code, children: [] }] }
        top().children.push(node)
        stack.push({ type: 'if', node, branch: node.branches[0], children: node.branches[0].children })
        break
      }
      case 'else': {
        const frame = top()
        if (frame.type !== 'if' || frame.node.kind !== 'if') {
          diags.push({ code: 'stray_else' })
          break
        }
        const branch: IfBranch = { test: tok.code, children: [] } // test null => final else
        frame.node.branches.push(branch)
        frame.branch = branch
        frame.children = branch.children
        break
      }
      case '/if': {
        if (top().type === 'if') stack.pop()
        else diags.push({ code: 'stray_close_block' })
        break
      }
      case 'each': {
        const m = /^([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?$/.exec(tok.code)
        if (!m) {
          diags.push({ code: 'invalid_each' })
          break
        }
        const node: SigNode = { kind: 'each', list: m[1], item: m[2], index: m[3] || 'i', children: [] }
        top().children.push(node)
        stack.push({ type: 'each', node, children: node.children })
        break
      }
      case '/each': {
        if (top().type === 'each') stack.pop()
        else diags.push({ code: 'stray_close_block' })
        break
      }
      case 'open': {
        const node: SigNode = { kind: 'el', tag: tok.name, props: tok.props, children: [] }
        top().children.push(node)
        if (!tok.selfClosing) stack.push({ type: 'el', node, children: node.children })
        break
      }
      case 'close': {
        let matched = -1
        for (let k = stack.length - 1; k >= 1; k--) {
          const f = stack[k]
          if (f.type === 'el' && f.node.kind === 'el' && f.node.tag === tok.name) {
            matched = k
            break
          }
        }
        if (matched < 0) {
          diags.push({ code: 'stray_close_tag', name: tok.name })
        } else {
          while (stack.length - 1 > matched) {
            const f = stack.pop()!
            diags.push({ code: 'unclosed_tag', name: f.node.kind === 'el' ? f.node.tag : '?' })
          }
          stack.pop()
        }
        break
      }
    }
  }
  flushInline()

  // EOF repair: auto-close anything still open.
  while (stack.length > 1) {
    const frame = stack.pop()!
    diags.push({ code: frame.type === 'el' ? 'unclosed_tag' : 'unclosed_block' })
  }
  return root.children
}

// Parse inline segments of a text run:
//   plain text | {expr} | **bold** (possibly containing {expr})
function parseInline(s: string): Seg[] {
  const parts: { t: 'str' | 'expr'; v: string; bold: boolean }[] = []
  let bold = false
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) {
      parts.push({ t: 'str', v: buf, bold })
      buf = ''
    }
  }
  while (i < s.length) {
    if (s.startsWith('**', i)) {
      flush()
      bold = !bold
      i += 2
    } else if (s[i] === '{') {
      const j = matchBrace(s, i)
      if (j < 0) {
        buf += s.slice(i)
        break
      }
      flush()
      parts.push({ t: 'expr', v: s.slice(i + 1, j).trim(), bold })
      i = j + 1
    } else {
      buf += s[i++]
    }
  }
  flush()

  // Fold consecutive bold-flagged parts into bold nodes.
  const segs: (Seg & { open?: boolean })[] = []
  for (const p of parts) {
    const seg: Seg = p.t === 'str' ? { t: 'str', v: p.v } : { t: 'expr', code: p.v }
    segs.push(seg)
    if (p.bold) {
      const last = segs[segs.length - 1]
      const prev = segs[segs.length - 2]
      if (prev && prev.t === 'bold' && prev.open) {
        prev.segs.push(last)
        segs.pop()
      } else {
        segs[segs.length - 1] = { t: 'bold', open: true, segs: [last] }
      }
    } else if (segs.length && segs[segs.length - 1].t === 'bold') {
      segs[segs.length - 1].open = false
    }
  }
  return segs.map(s2 => (s2.t === 'bold' ? { t: 'bold', segs: s2.segs } : s2))
}
