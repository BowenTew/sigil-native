# catalog-gallery

Every component in the Sigil catalog, live: the showcase program on the
left, the rendered native components in the middle, the SigilOps stream on
the right. Useful as a conformance check when adding a component — and as
few-shot material when writing prompts.

```bash
pnpm install        # from the repo root
pnpm build
pnpm --filter @sigil-native/example-catalog-gallery dev
# → http://localhost:8140 (served by the chat-web dev server)
```

The showcase program is a trusted static string, so it runs the runtime
in-page. Applications that execute model output should use the sandboxed
runner (`@sigil-native/web/runner`) instead.
