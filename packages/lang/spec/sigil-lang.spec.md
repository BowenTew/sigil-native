# Sigil Language Specification (v0, draft)

Sigil is a streaming UI language for LLMs: **Markdown prose + JSX-like
component tags from a fixed catalog + JavaScript for local state and logic**.
It is designed to be _written token-by-token by a model_ and compiled while
still incomplete.

## Lexical elements

| Element       | Form                                                                   | Notes                                                  |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Heading       | `## title` / `### title`                                               | maps to `title` component (lg/md)                      |
| Paragraph     | plain lines                                                            | `**bold**` inline; merged into `text` components       |
| Component     | `<tag prop={expr} flag>...</tag>` or `<tag .../>`                      | tags must be catalog members                           |
| Statement     | `{@body <js statement>}`                                               | one per line, top level; hoisted to component prologue |
| Interpolation | `{expr}`                                                               | anywhere in text or props                              |
| Conditional   | `{#if e}...{:else if e}...{:else}...{/if}`                             | block markers on their own lines                       |
| Loop          | `{#each list as item, i}...{/each}`                                    | block markers on their own lines                       |
| Action        | `Sigil.issueNewTurn(text)` · `Sigil.copy(text)` · `Sigil.openUrl(url)` | the only ways to reach outside                         |

## Streaming-tolerance rules

Any prefix of a valid document must compile. Therefore:

1. An unterminated `{...}` or `<...` at end-of-input is **dropped** (with an
   `unterminated_expr` / `unterminated_tag` diagnostic).
2. Unclosed elements/blocks at EOF are **auto-closed** (`unclosed_tag` /
   `unclosed_block`).
3. Statements live on their own lines so a partial line is simply dropped.
4. Static text is extracted into a constants table by the compiler, so growing
   text patches data, not the program.

## Catalog

See `catalog.schema.json` and the single source of truth:
`@sigil-native/lang`. Unknown tags are unwrapped (children preserved) with an
`unknown_tag` diagnostic.

## State

`Sigil.useState(initial)` — the compiler injects a stable key
(`{ key: "sN" }`) per statement position, so state survives recompilation
during streaming. Handlers are functions: `onChange={setSeats}` or
`onClick={() => Sigil.issueNewTurn("...")}`.

## Non-goals (v0)

- No raw HTML/CSS, no arbitrary layout (no flexbox/grid props) — layout is
  quantized into design tokens; complex visuals are future catalog components.
- No network/DOM in statements — statements run sandboxed.
