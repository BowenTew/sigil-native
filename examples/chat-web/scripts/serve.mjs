// chat-web dev/prod server (zero dependencies):
//   - static files from public/ and dist/
//   - /runner.html + /worker.iife.js from @sigil-native/web (the sandbox)
//   - POST /api/chat: LLM streaming proxy (Sigil system prompt)
//
// Inference config resolution order:
//   1. env SIGIL_LLM_BASE_URL / SIGIL_LLM_API_KEY / SIGIL_LLM_MODEL
//   2. ~/.zshenv.local (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)
//   3. defaults (msh free-tokens proxy, kimi-k2.8-highspeed)

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const exampleRoot = join(root, '..')
const port = Number(process.env.PORT || 8140)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
}

// ------------------------------------------------------------- inference cfg
function loadInferenceConfig() {
  const cfg = {
    baseURL: 'https://free-tokens.msh.team',
    apiKey: '',
    model: 'kimi-k2.8-highspeed',
  }
  try {
    const data = readFileSync(join(homedir(), '.zshenv.local'), 'utf8')
    for (const line of data.split('\n')) {
      const m = /^\s*(?:export\s+)?([\w]+)=(.*)$/.exec(line.trim())
      if (!m) continue
      const key = m[1]
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (key === 'ANTHROPIC_BASE_URL') cfg.baseURL = value
      if ((key === 'ANTHROPIC_AUTH_TOKEN' || key === 'STAFF_API_KEY') && !cfg.apiKey) cfg.apiKey = value
    }
  } catch {
    /* zshenv.local optional */
  }
  if (process.env.SIGIL_LLM_BASE_URL) cfg.baseURL = process.env.SIGIL_LLM_BASE_URL
  if (process.env.SIGIL_LLM_API_KEY) cfg.apiKey = process.env.SIGIL_LLM_API_KEY
  if (process.env.SIGIL_LLM_MODEL) cfg.model = process.env.SIGIL_LLM_MODEL
  cfg.baseURL = cfg.baseURL.replace(/\/+$/, '')
  if (!cfg.baseURL.endsWith('/v1')) cfg.baseURL += '/v1'
  return cfg
}

const SYSTEM_PROMPT = `You are the answer engine of a ChatGPT-like assistant. You reply in Sigil, a streaming UI language that mixes Markdown prose, JSX-like component tags from a fixed catalog, and JavaScript for local state and logic.

HARD RULES
1. Output ONLY Sigil. No code fences, no explanations, no HTML, no apologies.
2. Whenever the answer involves numbers, choices, comparisons, plans, or data, prefer a rich interactive UI over plain text. Use prose + components together.
3. Use ONLY components from the catalog. Unknown tags are stripped by the compiler.
4. Close every tag. Keep expressions simple and single-line. JavaScript runs in a sandbox: no fetch, no console, no DOM.
5. All state/logic goes in {@body ...} lines (one statement per line, top level, before the markup that uses them).
6. Interactions are local: bind value={state} onChange={setState}. Never simulate user clicks. Keep working state in Sigil.useState.
7. A button may continue the conversation via Sigil.issueNewTurn("...") — build the message from current state.

CATALOG (spacing scale: 1 unit = 4px)
  <box border? padding={n} gap={n} row?>...</box>   layout container
  <title size="lg|md|xl">...</title>                heading (## markdown -> lg)
  <text>...</text>                                 paragraph
  <caption>...</caption>                           small gray text
  <bold>...</bold>                                 inline emphasis (** also works)
  <chip>...</chip>                                 pill label
  <divider/>
  <slider min={n} max={n} value={state} onChange={setState}/>
  <checkbox checked={bool} onChange={(v) => ...}/>
  <button block? onClick={() => ...}>...</button>
  <barchart data={[{label: "Jan", value: 42}, ...]}/>

SYNTAX
  Markdown: "## heading", paragraphs, **bold** — mixed freely with tags.
  Statements: {@body const [x, setX] = Sigil.useState(0)}
  Interpolation: {expression}
  Conditionals (own lines): {#if expr} ... {:else if expr} ... {:else} ... {/if}
  Loops (own lines): {#each list as item, i} ... {/each}
  Actions: Sigil.issueNewTurn(text) · Sigil.copy(text) · Sigil.openUrl(url)

EXAMPLE — pricing answer:
## Team plan estimate

Drag the slider to see the **monthly price** for your team.

{@body const [seats, setSeats] = Sigil.useState(8)}
{@body const price = seats * 29}
<box border padding={3} gap={2}>
  <slider min={1} max={50} value={seats} onChange={setSeats}/>
  <title size="xl">$ {price} /mo</title>
</box>
<text>Estimated total: **$ {price * 12} /year** for {seats} seats.</text>
<button block onClick={() => Sigil.issueNewTurn("I want " + seats + " seats")}>Choose this plan</button>

Answer the user's request now, in Sigil.`

// ---------------------------------------------------------------- llm proxy
async function handleChat(req, res) {
  const cfg = loadInferenceConfig()
  let body = ''
  for await (const chunk of req) body += chunk
  let messages
  try {
    messages = JSON.parse(body).messages
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"error":"invalid json"}')
    return
  }
  if (!Array.isArray(messages) || !messages.length) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"error":"messages required"}')
    return
  }

  const upstream = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.map(m => ({ role: m.role, content: m.text }))],
    }),
  })
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'upstream error', detail: text.slice(0, 500) }))
    return
  }

  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
  })

  // Parse the SSE stream and forward content deltas as plain text.
  const reader = upstream.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content
        if (delta) res.write(delta)
      } catch {
        /* skip malformed chunk */
      }
    }
  }
  res.end()
}

// ------------------------------------------------------------------ statics
async function serveFile(res, file) {
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path === '/api/health') {
      const cfg = loadInferenceConfig()
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify({ status: 'ok', model: cfg.model }))
      return
    }
    if (path === '/api/chat' && req.method === 'POST') return await handleChat(req, res)

    if (path === '/runner.html') {
      return await serveFile(res, fileURLToPath(import.meta.resolve('@sigil-native/web/runner')))
    }
    if (path === '/worker.iife.js') {
      return await serveFile(res, fileURLToPath(import.meta.resolve('@sigil-native/web/worker')))
    }

    // /dist/* → examples/chat-web/dist; everything else → public/
    const file = path === '/' ? '/index.html' : path
    const staticRoot = file.startsWith('/dist/') ? join(exampleRoot, 'dist') : join(exampleRoot, 'public')
    const rel = file.startsWith('/dist/') ? file.slice('/dist/'.length) : file.slice(1)
    const resolved = normalize(join(staticRoot, rel))
    if (!resolved.startsWith(staticRoot)) throw new Error('forbidden')
    return await serveFile(res, resolved)
  } catch {
    res.writeHead(404, { 'access-control-allow-origin': '*' })
    res.end('not found')
  }
}).listen(port, () => {
  console.log(`chat-web → http://localhost:${port}`)
})
