# SigilOps Protocol Specification (v1, draft)

SigilOps is the platform-neutral instruction stream emitted by the Sigil
runtime and applied by renderers. It is the **only** contract between the
engine and a platform; renderers do not need to know the Sigil language.

## Messages (runtime → host)

```ts
type RuntimeMessage =
  | { type: 'ops'; ops: Op[] }
  | { type: 'action'; action: 'issueNewTurn' | 'copy' | 'openUrl'; text?: string; url?: string }
  | { type: 'error'; message: string }
```

## Operations

```ts
type Op =
  | { op: 'create'; id: string; parent: string; index: number; type: string; props?: object; text?: string }
  | { op: 'set'; id: string; props: object }
  | { op: 'text'; id: string; value: string }
  | { op: 'delete'; id: string }
```

- `type: '#text'` creates a text node with `text`.
- Function-valued props cross the boundary as handles: `{ __fn: "fn12" }`.
  Functions never leave the runtime.

## Identity & ordering

- Node ids are **tree paths** (`"2.1.0"` = root child 2, its child 1, its
  child 0). Ids are stable across re-renders while the shape is unchanged.
- Ops are emitted in application order (parents before children; deletes
  before creates at the same slot). Applying them sequentially must yield the
  new tree.

## Events (host → runtime)

```ts
{ type: 'event'; fnId: string; args: unknown[] }
```

The runtime invokes the handler; state updates re-render and produce a new
`ops` message. **No model call is involved.**

## Evaluation (host → runtime)

```ts
{ type: 'eval'; code: string; constants: Record<string, string>; appData?: object }
```

`code` is the compiled program (a JS function body evaluated via
`new Function('Sigil', '__sigil', '__sigilSafe', code)`). The runtime keeps
the last working program if a new one fails.
