# sigil-gateway — reference LLM gateway (coming)

A minimal streaming proxy: your chat backend → LLM with the Sigil system
prompt → Sigil source stream. Any stack works (the protocol is just text
over HTTP); a Go + Eino reference implementation will be provided.

Inference config is read from the environment, e.g.
`SIGIL_LLM_BASE_URL` / `SIGIL_LLM_API_KEY` / `SIGIL_LLM_MODEL`.
