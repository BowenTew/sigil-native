// catalog-gallery: compile the showcase program, run it, render it, and show
// the SigilOps stream next to the source. The program is a trusted static
// string, so the runtime runs in-page; chat apps use the sandboxed runner.

import { parseSigil, compile } from '@sigil-native/compiler'
import { CATALOG_TAGS } from '@sigil-native/lang'
import { createSigilRuntime } from '@sigil-native/runtime'
import { Renderer } from '@sigil-native/web'

import { SHOWCASE } from './showcase.ts'

import type { Op, RuntimeMessage } from '@sigil-native/runtime'

const sourcePane = document.getElementById('source') as HTMLPreElement
const opsPane = document.getElementById('ops') as HTMLPreElement
const opsCount = document.getElementById('ops-count') as HTMLSpanElement
const uiRoot = document.getElementById('ui') as HTMLDivElement
const diagBadge = document.getElementById('diagnostics') as HTMLSpanElement

sourcePane.textContent = SHOWCASE

function showActionToast(text: string): void {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = `Sigil.issueNewTurn("${text}")`
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}

let opsTotal = 0
const rt = createSigilRuntime((msg: RuntimeMessage) => {
  if (msg.type === 'action' && msg.action === 'issueNewTurn') {
    showActionToast(msg.text ?? '')
    return
  }
  if (msg.type !== 'ops') return
  renderer.apply(msg.ops)
  for (const op of msg.ops) {
    opsPane.textContent += opLine(op) + '\n'
    opsTotal++
  }
  opsCount.textContent = String(opsTotal)
  opsPane.scrollTop = opsPane.scrollHeight
})

const renderer = new Renderer(uiRoot, (fnId, args) => rt.handleEvent(fnId, args))

const { nodes, diagnostics } = parseSigil(SHOWCASE)
const out = compile(nodes, { catalog: new Set<string>(CATALOG_TAGS), diagnostics })
diagBadge.textContent = out.diagnostics.length
  ? `${out.diagnostics.length} diagnostics: ${out.diagnostics.map(d => d.code).join(', ')}`
  : 'compiled clean ✓'
rt.evaluate(out.code, out.constants)

function opLine(op: Op): string {
  const propsStr = (props: Record<string, unknown> | undefined): string =>
    Object.entries(props || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
  switch (op.op) {
    case 'create': {
      if (op.type === '#text') {
        return `CREATE #${op.id} text ${JSON.stringify(op.text)} PLACE under #${op.parent} at ${op.index}`
      }
      const p = propsStr(op.props)
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
