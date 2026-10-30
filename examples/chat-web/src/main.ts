// chat-web host: chat UI + streaming + engine-side compile + sandboxed run.
//
//   user message → POST /api/chat (Sigil source streams back)
//     → parse + compile on every chunk (the "server side" of the architecture)
//     → post the compiled program to the message's sandboxed runner iframe
//     → worker evaluates, diffs, streams SigilOps back → native components
//     → DOM events go back to the worker; actions (issueNewTurn/…) come here

import { parseSigil, compile } from '@sigil-native/compiler'
import { CATALOG_TAGS } from '@sigil-native/lang'
import { Renderer } from '@sigil-native/web'

import type { Op } from '@sigil-native/runtime'

// ------------------------------------------------------------------ dom refs
const chatEl = document.getElementById('chat') as HTMLDivElement
const composer = document.getElementById('composer') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
const sendBtn = document.getElementById('send') as HTMLButtonElement
const emptyState = document.getElementById('empty-state') as HTMLDivElement
const chatList = document.getElementById('chat-list') as HTMLDivElement
const connBadge = document.getElementById('conn-badge') as HTMLSpanElement
const modelName = document.getElementById('model-name') as HTMLSpanElement

// ------------------------------------------------------------- conversations
interface Conversation {
  id: string
  title: string
  messages: StoredMessage[]
}
interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  source?: string // assistant: raw Sigil source
  msgId?: string
}

let conversations: Conversation[] = []
let activeId: string | null = null

function loadConversations(): void {
  try {
    conversations = JSON.parse(localStorage.getItem('sigil-conversations') || '[]')
  } catch {
    conversations = []
  }
}
function saveConversations(): void {
  try {
    localStorage.setItem('sigil-conversations', JSON.stringify(conversations))
  } catch {
    /* quota — ignore */
  }
}
function activeConv(): Conversation | undefined {
  return conversations.find(c => c.id === activeId)
}
function newConversation(): Conversation {
  const conv: Conversation = { id: 'c' + Date.now(), title: '新聊天', messages: [] }
  conversations.unshift(conv)
  activeId = conv.id
  return conv
}

// ------------------------------------------------------------ message records
interface LiveMessage {
  id: string
  iframe: HTMLIFrameElement
  raw: string
  renderer: Renderer
  placeholder: HTMLDivElement
  srcPre: HTMLPreElement
  codePre: HTMLPreElement
  opsPre: HTMLPreElement
  opsBtn: HTMLButtonElement
  opsCount: Record<string, number>
  opsLines: number
  badge: HTMLSpanElement
  lastCompile: number
  lastDiags: number
}

let msgSeq = 0
const messages = new Map<string, LiveMessage>()

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data
  if (!d || d.__sigil !== 'worker') return
  const msg = messages.get(d.msgId)
  if (!msg) return
  const data = d.data || {}
  if (data.type === 'ops') {
    msg.renderer.apply(data.ops as Op[])
    msg.placeholder.remove()
    appendOps(msg, data.ops as Op[])
  } else if (data.type === 'action') {
    handleAction(data)
  } else if (data.type === 'error') {
    setBadge(msg, 'worker: ' + data.message, 'warn')
  }
})

function handleAction(data: { action?: string; text?: string; url?: string }): void {
  if (data.action === 'issueNewTurn' && data.text) {
    // The interface's only channel back to the model: a plain user message.
    void sendUserMessage(data.text)
  } else if (data.action === 'copy' && data.text) {
    void navigator.clipboard?.writeText(data.text)
    toast('已复制')
  } else if (data.action === 'openUrl' && data.url) {
    window.open(data.url, '_blank', 'noopener')
  }
}

// ------------------------------------------------------------------ chat UI
function hideEmptyState(): void {
  if (emptyState) emptyState.style.display = 'none'
}
function showEmptyStateIfNeeded(): void {
  const conv = activeConv()
  if (emptyState) emptyState.style.display = conv && conv.messages.length ? 'none' : ''
}

function addUserMessage(text: string): void {
  const el = document.createElement('div')
  el.className = 'msg user'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = text
  el.appendChild(bubble)
  chatEl.appendChild(el)
  scrollDown()
}

function addAssistantMessage(): LiveMessage {
  hideEmptyState()
  const id = 'm' + ++msgSeq
  const el = document.createElement('div')
  el.className = 'msg assistant'
  el.innerHTML = '<div class="avatar">✳️</div>'
  const content = document.createElement('div')
  content.className = 'content'

  const placeholder = document.createElement('div')
  placeholder.className = 'placeholder'
  placeholder.textContent = '正在生成界面…'

  const uiRoot = document.createElement('div')
  uiRoot.className = 'ui-root'

  const actions = document.createElement('div')
  actions.className = 'actions'
  const copyBtn = document.createElement('button')
  copyBtn.textContent = '复制'
  const srcBtn = document.createElement('button')
  srcBtn.textContent = 'Sigil 源码'
  const codeBtn = document.createElement('button')
  codeBtn.textContent = '编译产物'
  const opsBtn = document.createElement('button')
  opsBtn.textContent = '渲染指令'
  const badge = document.createElement('span')
  badge.className = 'badge'
  actions.append(copyBtn, srcBtn, codeBtn, opsBtn, badge)

  const srcPre = document.createElement('pre')
  srcPre.className = 'pane'
  srcPre.hidden = true
  const codePre = document.createElement('pre')
  codePre.className = 'pane'
  codePre.hidden = true
  const opsPre = document.createElement('pre')
  opsPre.className = 'pane'
  opsPre.hidden = true

  srcBtn.onclick = () => (srcPre.hidden = !srcPre.hidden)
  codeBtn.onclick = () => (codePre.hidden = !codePre.hidden)
  opsBtn.onclick = () => (opsPre.hidden = !opsPre.hidden)

  content.append(placeholder, uiRoot, actions, srcPre, codePre, opsPre)
  el.appendChild(content)
  chatEl.appendChild(el)
  scrollDown()

  // One sandboxed runner (iframe + worker) per assistant message.
  const iframe = document.createElement('iframe')
  iframe.className = 'runner'
  iframe.sandbox.add('allow-scripts')
  iframe.src = '/runner.html'
  document.body.appendChild(iframe)

  const msg: LiveMessage = {
    id,
    iframe,
    raw: '',
    renderer: new Renderer(uiRoot, (fnId, args) => {
      iframe.contentWindow?.postMessage({ __sigil: 'host', msgId: id, type: 'event', fnId, args }, '*')
    }),
    placeholder,
    srcPre,
    codePre,
    opsPre,
    opsBtn,
    opsCount: {},
    opsLines: 0,
    badge,
    lastCompile: 0,
    lastDiags: 0,
  }
  copyBtn.onclick = () => {
    void navigator.clipboard?.writeText(msg.raw)
    toast('已复制')
  }
  messages.set(id, msg)
  return msg
}

function setBadge(msg: LiveMessage, text: string, kind: string): void {
  msg.badge.textContent = text
  msg.badge.className = 'badge ' + kind
}

function scrollDown(): void {
  chatEl.scrollTop = chatEl.scrollHeight
}

function toast(text: string): void {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 1600)
}

// ------------------------------------------------------- ops viewer (SigilOps)
function opLine(op: Op): string {
  const propsStr = (props: Record<string, unknown> | undefined): string =>
    Object.entries(props || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
  switch (op.op) {
    case 'create': {
      const p = propsStr(op.props)
      if (op.type === '#text') {
        return `CREATE #${op.id} text ${JSON.stringify(op.text)} PLACE under #${op.parent} at ${op.index}`
      }
      return `CREATE #${op.id} ${op.type}${p ? ' SET ' + p : ''} PLACE under #${op.parent} at ${op.index}`
    }
    case 'set':
      return `SET    #${op.id} ${propsStr(op.props)}`
    case 'text':
      return `TEXT   #${op.id} ${JSON.stringify(op.value)}`
    case 'delete':
      return `DELETE #${op.id}`
  }
}

function appendOps(msg: LiveMessage, ops: Op[]): void {
  for (const op of ops) {
    msg.opsCount[op.op] = (msg.opsCount[op.op] || 0) + 1
    if (msg.opsLines < 400) {
      msg.opsPre.textContent += opLine(op) + '\n'
      msg.opsLines++
    }
  }
  const c = msg.opsCount
  const total = (c.create || 0) + (c.set || 0) + (c.text || 0) + (c.delete || 0)
  msg.opsBtn.textContent = `渲染指令 · ${total}`
  msg.opsPre.scrollTop = msg.opsPre.scrollHeight
}

// -------------------------------------------------- streaming + engine compile
async function streamSigil(conv: Conversation): Promise<Response> {
  const history = conv.messages
    .filter(m => m.role === 'user' || m.source || m.text)
    .slice(-12)
    .map(m => ({ role: m.role, text: m.role === 'assistant' ? m.source || m.text : m.text }))
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: history }),
  })
  if (!resp.ok || !resp.body) throw new Error('bad response')
  return resp
}

async function streamResponse(msg: LiveMessage, conv: Conversation): Promise<void> {
  const resp = await streamSigil(conv)
  const reader = resp.body!.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    msg.raw += dec.decode(value, { stream: true })
    msg.srcPre.textContent = msg.raw
    const now = performance.now()
    if (now - msg.lastCompile > 120) {
      compileAndSend(msg)
      msg.lastCompile = now
    }
    scrollDown()
  }
  compileAndSend(msg) // final
  const repairs = msg.lastDiags
  setBadge(msg, repairs ? `compiled ✓ · 流式修复 ${repairs} 处` : 'compiled ✓', repairs ? 'warn' : 'ok')
  const rec = conv.messages.find(m => m.msgId === msg.id)
  if (rec) {
    rec.source = msg.raw
    saveConversations()
  }
}

// The "server side" of the architecture: raw Sigil in, runnable program out.
function compileAndSend(msg: LiveMessage): void {
  const { nodes, diagnostics } = parseSigil(msg.raw)
  const out = compile(nodes, { catalog: new Set<string>(CATALOG_TAGS), diagnostics })
  msg.lastDiags = out.diagnostics.length
  msg.codePre.textContent = out.code
  msg.iframe.contentWindow?.postMessage(
    { __sigil: 'host', msgId: msg.id, type: 'eval', code: out.code, constants: out.constants, appData: {} },
    '*',
  )
}

// ------------------------------------------------------------------- driver
async function sendUserMessage(text: string): Promise<void> {
  const conv = activeConv() || newConversation()
  conv.messages.push({ role: 'user', text })
  if (conv.messages.length === 1) conv.title = text.slice(0, 24)
  saveConversations()
  renderChatList()
  addUserMessage(text)
  sendBtn.disabled = true

  await sleep(250)
  const msg = addAssistantMessage()
  const rec: StoredMessage = { role: 'assistant', text: '', msgId: msg.id }
  conv.messages.push(rec)
  await sleep(250) // let the runner iframe boot
  try {
    await streamResponse(msg, conv)
  } catch {
    setBadge(msg, '网关不可用 · 请检查 server 配置（SIGIL_LLM_*）', 'warn')
  }
  sendBtn.disabled = false
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

composer.addEventListener('submit', (e: Event) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  void sendUserMessage(text)
})

emptyState.addEventListener('click', (e: Event) => {
  const q = (e.target as HTMLElement).dataset?.q
  if (q) void sendUserMessage(q)
})

// ------------------------------------------------------------ sidebar / convs
function renderChatList(): void {
  chatList.innerHTML = ''
  for (const conv of conversations) {
    const item = document.createElement('div')
    item.className = 'chat-item' + (conv.id === activeId ? ' active' : '')
    const title = document.createElement('span')
    title.textContent = conv.title || '新聊天'
    title.style.overflow = 'hidden'
    title.style.textOverflow = 'ellipsis'
    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '🗑'
    del.onclick = (e: Event) => {
      e.stopPropagation()
      conversations = conversations.filter(c => c.id !== conv.id)
      if (activeId === conv.id) {
        activeId = null
        teardownAll()
        if (conversations.length) switchConversation(conversations[0].id)
        else {
          newConversation()
          renderConversation()
          renderChatList()
        }
      }
      saveConversations()
      renderChatList()
    }
    item.append(title, del)
    item.onclick = () => switchConversation(conv.id)
    chatList.appendChild(item)
  }
}

function teardownAll(): void {
  for (const msg of messages.values()) msg.iframe.remove()
  messages.clear()
  for (const el of [...chatEl.children]) {
    if (el.id !== 'empty-state') el.remove()
  }
}

// Rebuild the view of the active conversation. Assistant messages that already
// have Sigil source are recompiled instantly (no streaming animation).
function renderConversation(): void {
  teardownAll()
  const conv = activeConv()
  if (!conv) return
  showEmptyStateIfNeeded()
  for (const m of conv.messages) {
    if (m.role === 'user') {
      addUserMessage(m.text)
    } else {
      const msg = addAssistantMessage()
      m.msgId = msg.id
      msg.raw = m.source || ''
      msg.srcPre.textContent = msg.raw
      compileAndSend(msg)
      setBadge(msg, 'compiled ✓ (已恢复)', 'ok')
    }
  }
  scrollDown()
}

function switchConversation(id: string): void {
  activeId = id
  renderConversation()
  renderChatList()
}

document.getElementById('new-chat')!.addEventListener('click', () => {
  newConversation()
  renderConversation()
  renderChatList()
  input.focus()
})

document.getElementById('toggle-sb')!.addEventListener('click', () => {
  document.getElementById('sidebar')!.classList.toggle('collapsed')
})

// -------------------------------------------------------------------- boot
async function boot(): Promise<void> {
  loadConversations()
  try {
    const resp = await fetch('/api/health')
    if (resp.ok) {
      const info = (await resp.json()) as { model?: string }
      modelName.textContent = 'sigil-native · ' + (info.model || '')
      connBadge.textContent = '● 在线'
      connBadge.className = 'conn-badge online'
    }
  } catch {
    /* offline */
  }
  if (!conversations.length) newConversation()
  renderConversation()
  renderChatList()
}

void boot()
