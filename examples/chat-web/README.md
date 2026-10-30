# chat-web

A ChatGPT-style web chat built on sigil-native: the model answers in Sigil,
the page compiles it per chunk, and each reply runs in its own sandboxed
worker, rendered as native components.

```bash
pnpm install        # from the repo root
pnpm build          # build engine packages + this example
pnpm --filter @sigil-native/example-chat-web start
# → http://localhost:8140
```

For development (rebuild the page bundle on change):

```bash
pnpm --filter @sigil-native/example-chat-web dev
```

## Inference configuration

The bundled gateway (`scripts/serve.mjs`) streams from any OpenAI-compatible
chat-completions endpoint. Configuration resolution:

1. `SIGIL_LLM_BASE_URL` / `SIGIL_LLM_API_KEY` / `SIGIL_LLM_MODEL`
2. `~/.zshenv.local` (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`)
3. built-in defaults

## What to look at

- Drag sliders / toggle controls — interactions never call the model; the
  worker re-renders and streams SigilOps diffs.
- Per-message panels: **Sigil 源码**(raw source),**编译产物**(the JS program
  the client runs),**渲染指令**(the live op stream).
- The block button calls `Sigil.issueNewTurn(...)`, which arrives here as a
  plain user message.
