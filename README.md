# sigil-native

**LLM writes sigils, native renders them.**

An open runtime for LLM-generated native UI — the [DIL architecture](https://www.openui.com/blog/how-chatgpt-intelligent-ui-works), open-sourced: a streaming UI language an LLM can write reliably, compiled to a plain JS program, executed in a sandbox, rendered as **native components** on every platform via a platform-neutral op protocol (SigilOps).

```
LLM ──streams Sigil──► compiler ──program+constants──► sandboxed runtime ──SigilOps──► native UI
 (Markdown + tags + JS)   (repair·validate)              (hooks·reconciler)        (Web / iOS / Android)
```

Interactions run **entirely on-device**: dragging a slider never calls the model. The only channel back is `Sigil.issueNewTurn()`, which emits a plain user message.

## Status

🚧 Early skeleton — APIs will change. The compiler, runtime and web renderer work end-to-end; iOS/Android renderers and the reference gateway are being ported in.

## Repo layout

| Path                                | What                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `packages/lang`                     | **Single source of truth**: catalog tags, design tokens, ops protocol version |
| `packages/compiler`                 | Streaming-tolerant parser + codegen (Sigil → JS program + constants)          |
| `packages/runtime`                  | Sandboxed execution, hooks, reconciler → SigilOps (zero-DOM, isomorphic)      |
| `renderers/web`                     | DOM applier + component catalog + sandboxed runner iframe                     |
| `renderers/ios` `renderers/android` | Native renderers (SwiftUI / Compose) — coming                                 |
| `server/`                           | Reference gateway: LLM streaming + Sigil system prompt — coming               |
| `examples/`                         | Full chat apps — coming                                                       |
| `docs/adr/`                         | Architecture decision records                                                 |

## Quickstart

```bash
pnpm install
pnpm test           # e2e: parse → compile → run → interact
pnpm typecheck      # tsgo (TypeScript 7 native compiler)
pnpm typecheck:rs   # tsrs (Rust port — cross-checks the same config)
pnpm build          # tsdown → dist/ (esm + d.ts + iife globals)
pnpm lint           # @fetuye/eslint
```

A taste of the language:

```sigil
## Team plan estimate

{@body const [seats, setSeats] = Sigil.useState(8)}
{@body const price = seats * 29}
<box border padding={3} gap={2}>
  <slider min={1} max={50} value={seats} onChange={setSeats}/>
  <title size="xl">${price}/mo</title>
</box>
<button block onClick={() => Sigil.issueNewTurn("I want " + seats + " seats")}>
  Choose this plan
</button>
```

## Why "sigils"?

The model inscribes _symbols_ (a constrained, streaming-safe DSL); the native side gives them form. The DSL is deliberately a subset of what React Native offers — layout is quantized into design tokens and catalog components, because **layout is where models fail**. For the full rationale, see `docs/adr/0001-architecture.md`.

## Relationship to other projects

- **OpenAI DIL / Intelligent UI** — the architecture this project implements openly (via public reverse engineering; no affiliation).
- **OpenUI (Thesys), A2UI (Google)** — protocols/specs. sigil-native is a full loop: language + compiler + sandbox runtime + native renderers.
- **React Native** — the spiritual relative: reconciler + native instructions, but the instructions (SigilOps) are the public cross-platform contract.

## License

MIT
