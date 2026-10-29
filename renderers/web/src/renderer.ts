// Web ops applier: applies SigilOps to the DOM.
// Each assistant message owns one Renderer (paired with one sandboxed runner).

import { CATALOG } from './catalog.ts'

import type { EventContext } from './catalog.ts'
import type { Op } from '@sigil-native/runtime'

export class Renderer {
  private map = new Map<string, Node>()
  private ctx: EventContext

  constructor(container: HTMLElement, onEvent: (fnId: string, args: unknown[]) => void) {
    this.map.set('root', container)
    this.ctx = {
      call: (fnId, args) => {
        if (fnId) onEvent(fnId, args || [])
      },
    }
  }

  apply(ops: Op[]): void {
    for (const op of ops) {
      switch (op.op) {
        case 'create':
          this.create(op)
          break
        case 'set': {
          const node = this.map.get(op.id) as HTMLElement | undefined
          if (!node) break
          const el = node as HTMLElement & { __sigilProps?: Record<string, unknown>; __sigilType?: string }
          el.__sigilProps = { ...(el.__sigilProps || {}), ...op.props }
          const comp = CATALOG[el.__sigilType || '']
          if (comp && comp.update) comp.update(el, op.props, this.ctx)
          break
        }
        case 'text': {
          const node = this.map.get(op.id)
          if (node) node.nodeValue = op.value
          break
        }
        case 'delete': {
          const node = this.map.get(op.id) as ChildNode | undefined
          if (node) node.remove()
          this.map.delete(op.id)
          break
        }
      }
    }
  }

  private create(op: Op & { op: 'create' }): void {
    let node: Node
    if (op.type === '#text') {
      node = document.createTextNode(op.text || '')
    } else {
      const comp = CATALOG[op.type]
      if (!comp) return // never render unknown component types
      const el = comp.create(op.props || {}, this.ctx) as HTMLElement & {
        __sigilType?: string
        __sigilProps?: Record<string, unknown>
      }
      el.__sigilType = op.type
      el.__sigilProps = op.props || {}
      el.classList && el.classList.add('sigil-enter')
      node = el
    }
    this.map.set(op.id, node)
    const parent = this.map.get(op.parent) as HTMLElement | undefined
    if (!parent) return
    const host = (parent as HTMLElement & { __sigilHost?: HTMLElement }).__sigilHost || parent
    host.insertBefore(node, host.childNodes[op.index] || null)
  }
}
