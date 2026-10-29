// Sigil runtime — the sandboxed execution environment.
//
// Responsibilities:
//   - evaluate the compiled program (a plain JS function; no Sigil parser here);
//   - provide hooks: Sigil.useState with stable keys, Sigil.useConstants,
//     Sigil.useAppData, plus the host bridge actions (Sigil.issueNewTurn,
//     Sigil.copy, Sigil.openUrl);
//   - act as a small React-style reconciler: render -> diff against the
//     previous tree -> emit a list of operations (SigilOps) to the host;
//   - keep state across re-evaluations (streaming recompiles) via keyed slots;
//   - keep the last working program if a new one fails (the UI never dies on
//     model error).
//
// Zero-DOM by design: runs in a Web Worker, in JavaScriptCore (iOS/macOS),
// or in Node (tests) — only the injected `post` callback crosses the boundary.

// ---------------------------------------------------------------- protocol

export type Op =
  | {
      op: 'create'
      id: string
      parent: string
      index: number
      type: string
      props?: Record<string, unknown>
      text?: string
    }
  | { op: 'set'; id: string; props: Record<string, unknown> }
  | { op: 'text'; id: string; value: string }
  | { op: 'delete'; id: string }

export type RuntimeMessage =
  | { type: 'ops'; ops: Op[] }
  | { type: 'action'; action: 'issueNewTurn' | 'copy' | 'openUrl'; text?: string; url?: string }
  | { type: 'error'; message: string }

export type PostFn = (msg: RuntimeMessage) => void

export interface DilRuntime {
  evaluate(code: string, constants: Record<string, string>, appData?: Record<string, unknown>): void
  handleEvent(fnId: string, args: unknown[]): void
}

// ------------------------------------------------------------------ element

export interface SigilElement {
  type: string | ((props: Record<string, unknown>) => unknown)
  props: Record<string, unknown>
  children: unknown[]
}

interface WireNode {
  id: string
  type: string
  props: Record<string, unknown>
  text?: string
  children: WireNode[]
}

type FlatItem = { text: string } | SigilElement

export const FRAGMENT = '__fragment'

export function createSigilRuntime(post: PostFn): DilRuntime {
  const stateSlots = new Map<string, { value: unknown }>()
  const fnMap = new Map<string, (...args: unknown[]) => void>()
  let fnSeq = 0

  let constants: Record<string, string> = {}
  let appData: Record<string, unknown> = {}
  let lastProgram: ((...args: unknown[]) => unknown) | null = null
  let prevTree: WireNode | null = null
  let hookSeq = 0
  let rendering = false
  let renderQueued = false
  let lastRenderFailed = false

  // ------------------------------------------------------------ jsx runtime
  function jsx(
    type: SigilElement['type'],
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): SigilElement {
    return { type, props: props || {}, children }
  }

  // Flatten fragments / arrays / primitives into a normalized child list.
  function flatten(v: unknown, out: FlatItem[]): void {
    if (v === null || v === undefined || typeof v === 'boolean') return
    if (Array.isArray(v)) {
      for (const x of v) flatten(x, out)
      return
    }
    if (typeof v === 'string' || typeof v === 'number') {
      out.push({ text: String(v) })
      return
    }
    const el = v as SigilElement
    if (el.type === FRAGMENT) {
      flatten(el.children, out)
      return
    }
    out.push(el)
  }

  // Turn a rendered value into a wire node tree with stable path ids.
  function normalizeList(list: unknown[], path: string, oldNode: WireNode | null): WireNode[] {
    const flat: FlatItem[] = []
    flatten(list, flat)
    const oldChildren = oldNode ? oldNode.children : null
    return flat.map((v, i) => {
      const id = path ? `${path}.${i}` : String(i)
      const oldChild = oldChildren && oldChildren[i]
      if ('text' in v) {
        return { id, type: '#text', props: {}, text: v.text, children: [] }
      }
      const props: Record<string, unknown> = {}
      for (const [name, val] of Object.entries(v.props || {})) {
        if (typeof val === 'function') {
          // Handlers never leave the runtime; reuse the id when the path is
          // stable so unchanged handlers don't produce update ops.
          const oldVal = oldChild && oldChild.props ? oldChild.props[name] : null
          const oldFn = oldVal as { __fn?: string } | null
          const fnId = oldFn && oldFn.__fn ? oldFn.__fn : `fn${++fnSeq}`
          fnMap.set(fnId, val as (...args: unknown[]) => void)
          props[name] = { __fn: fnId }
        } else {
          props[name] = val
        }
      }
      const children = normalizeList(v.children || [], id, oldChild)
      return { id, type: v.type as string, props, children }
    })
  }

  // ---------------------------------------------------------------- diffing
  function diffProps(oldP: Record<string, unknown>, newP: Record<string, unknown>): Record<string, unknown> | null {
    const changed: Record<string, unknown> = {}
    let any = false
    for (const k of new Set([...Object.keys(oldP || {}), ...Object.keys(newP || {})])) {
      const a = JSON.stringify(oldP ? oldP[k] : undefined)
      const b = JSON.stringify(newP ? newP[k] : undefined)
      if (a !== b) {
        changed[k] = newP ? newP[k] : undefined
        any = true
      }
    }
    return any ? changed : null
  }

  function emitCreate(node: WireNode, parentId: string, index: number, ops: Op[]): void {
    if (node.type === '#text') {
      ops.push({ op: 'create', id: node.id, parent: parentId, index, type: '#text', text: node.text })
      return
    }
    ops.push({ op: 'create', id: node.id, parent: parentId, index, type: node.type, props: node.props })
    node.children.forEach((c, i) => emitCreate(c, node.id, i, ops))
  }

  function diffNode(
    oldN: WireNode | undefined,
    newN: WireNode | undefined,
    parentId: string,
    index: number,
    ops: Op[],
  ): void {
    if (!oldN && !newN) return
    if (!oldN) {
      emitCreate(newN!, parentId, index, ops)
      return
    }
    if (!newN) {
      ops.push({ op: 'delete', id: oldN.id })
      return
    }
    if (oldN.type !== newN.type) {
      ops.push({ op: 'delete', id: oldN.id })
      emitCreate(newN, parentId, index, ops)
      return
    }
    if (newN.type === '#text') {
      if (oldN.text !== newN.text) {
        ops.push({ op: 'text', id: newN.id, value: newN.text ?? '' })
      }
      return
    }
    const changed = diffProps(oldN.props, newN.props)
    if (changed) ops.push({ op: 'set', id: newN.id, props: changed })
    const len = Math.max(oldN.children.length, newN.children.length)
    for (let i = 0; i < len; i++) {
      diffNode(oldN.children[i], newN.children[i], newN.id, i, ops)
    }
  }

  // ------------------------------------------------------------------ hooks
  interface UseStateOptions {
    key?: string
  }

  const Sigil = {
    render(el: unknown): unknown {
      return el
    },
    useConstants(): Record<string, string> {
      return constants
    },
    useAppData<T>(selector?: (appData: Record<string, unknown>) => T): T | Record<string, unknown> {
      return selector ? selector(appData) : appData
    },
    useState<T>(init: T | (() => T), opts?: UseStateOptions): [T, (v: T | ((prev: T) => T)) => void] {
      const key = (opts && opts.key) || `auto:${hookSeq}`
      hookSeq++
      let slot = stateSlots.get(key)
      if (!slot) {
        slot = { value: typeof init === 'function' ? (init as () => T)() : init }
        stateSlots.set(key, slot)
      }
      const set = (v: T | ((prev: T) => T)) => {
        slot!.value = typeof v === 'function' ? (v as (prev: T) => T)(slot!.value as T) : v
        scheduleRender()
      }
      return [slot.value as T, set]
    },
    // Host bridge: the only ways a program reaches outside the response.
    issueNewTurn: (text: string) => post({ type: 'action', action: 'issueNewTurn', text: String(text) }),
    copy: (text: string) => post({ type: 'action', action: 'copy', text: String(text) }),
    openUrl: (url: string) => post({ type: 'action', action: 'openUrl', url: String(url) }),
  }

  const __sigil = { Fragment: FRAGMENT, jsx }

  function __sigilSafe<T>(evaluate: () => T, failureValue: T): T {
    try {
      return evaluate()
    } catch {
      return failureValue
    }
  }

  // ---------------------------------------------------------------- render
  function renderRoot(): void {
    if (rendering) {
      renderQueued = true
      return
    }
    rendering = true
    lastRenderFailed = false
    try {
      let rounds = 0
      do {
        renderQueued = false
        hookSeq = 0
        let el = lastProgram!(Sigil, __sigil, __sigilSafe) as SigilElement | unknown
        if (el && typeof (el as SigilElement).type === 'function') {
          const comp = el as SigilElement
          el = (comp.type as (props: Record<string, unknown>) => unknown)(comp.props)
        }
        const children = normalizeList([el], '', prevTree)
        const root: WireNode = { id: 'root', type: '#root', props: {}, children }
        const ops: Op[] = []
        const oldRoot = prevTree || { id: 'root', type: '#root', props: {}, children: [] }
        diffNode(oldRoot, root, '', 0, ops)
        prevTree = root
        if (ops.length) post({ type: 'ops', ops })
      } while (renderQueued && ++rounds < 5)
    } catch (e) {
      // Keep the previous tree & program; the UI keeps working.
      lastRenderFailed = true
      post({ type: 'error', message: 'render failed: ' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      rendering = false
    }
  }

  function scheduleRender(): void {
    if (rendering) {
      renderQueued = true
    } else {
      renderRoot()
    }
  }

  return {
    evaluate(code: string, newConstants: Record<string, string>, newAppData: Record<string, unknown> = {}) {
      constants = newConstants || {}
      appData = newAppData || {}
      let fn: (...args: unknown[]) => unknown
      try {
        fn = new Function('Sigil', '__sigil', '__sigilSafe', code) as (...args: unknown[]) => unknown
      } catch (e) {
        post({ type: 'error', message: 'compile failed: ' + (e instanceof Error ? e.message : String(e)) })
        return
      }
      const prev = lastProgram
      lastProgram = fn
      renderRoot()
      // If the new program failed to render, keep the last working one so
      // interactions with the already-displayed UI continue to function.
      if (lastRenderFailed) lastProgram = prev
    },
    handleEvent(fnId: string, args: unknown[]) {
      const fn = fnMap.get(fnId)
      if (!fn) return
      try {
        fn(...(args || []))
      } catch (e) {
        post({ type: 'error', message: 'handler failed: ' + (e instanceof Error ? e.message : String(e)) })
      }
    },
  }
}
