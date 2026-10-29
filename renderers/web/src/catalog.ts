// Web component catalog + design tokens — the DOM implementation of the
// Sigil catalog (see packages/lang for the single source of truth).
//
// The model can only compose components from this catalog; the renderer only
// knows how to draw these types. This is what keeps generated interfaces
// looking like the host product instead of arbitrary web pages.

import { CATALOG_TAGS, TOKENS } from '@sigil-native/lang'

export type EventContext = {
  call: (fnId: string | undefined, args: unknown[]) => void
}

export interface WebComponent {
  create: (props: Record<string, any>, ctx: EventContext) => HTMLElement
  update?: (el: HTMLElement, props: Record<string, any>, ctx: EventContext) => void
}

const SPACING = TOKENS.spacing // px per spacing step: padding={3} -> 12px

function applyBox(el: HTMLElement, props: Record<string, any>): void {
  const p = props || {}
  el.style.display = 'flex'
  el.style.flexDirection = p.row ? 'row' : 'column'
  el.style.gap = ((p.gap || 0) as number) * SPACING + 'px'
  el.style.padding = ((p.padding || 0) as number) * SPACING + 'px'
  el.classList.toggle('bordered', !!p.border)
}

function applySlider(wrap: HTMLElement, input: HTMLInputElement, val: HTMLElement, props: Record<string, any>): void {
  const p = props || {}
  if (p.min !== undefined) input.min = p.min
  if (p.max !== undefined) input.max = p.max
  if (p.value !== undefined && document.activeElement !== input) input.value = p.value
  val.textContent = String(p.value !== undefined ? p.value : '')
}

function applyCheckbox(input: HTMLInputElement, props: Record<string, any>): void {
  const p = props || {}
  if (p.checked !== undefined) input.checked = !!p.checked
}

function renderChart(el: HTMLElement, props: Record<string, any>): void {
  const data: { label?: string; value?: number }[] = (props && props.data) || []
  const max = Math.max(1, ...data.map(d => Number(d.value) || 0))
  el.innerHTML = ''
  const bars = document.createElement('div')
  bars.className = 'sigil-chart-bars'
  for (const d of data) {
    const bar = document.createElement('div')
    bar.className = 'sigil-chart-bar'
    bar.style.height = Math.round(((Number(d.value) || 0) / max) * 100) + '%'
    bar.title = `${d.label}: ${d.value}`
    bars.appendChild(bar)
  }
  const labels = document.createElement('div')
  labels.className = 'sigil-chart-labels'
  for (const d of data) {
    const s = document.createElement('span')
    s.textContent = d.label ?? ''
    labels.appendChild(s)
  }
  el.appendChild(bars)
  el.appendChild(labels)
}

export const CATALOG: Record<string, WebComponent> = {
  box: {
    create(props) {
      const el = document.createElement('div')
      el.className = 'sigil-box'
      ;(el as any).__sigilHost = el
      applyBox(el, props)
      return el
    },
    update(el, props) {
      applyBox(el, props)
    },
  },

  title: {
    create(props) {
      const el = document.createElement('div')
      el.className = 'sigil-title t-' + ((props && props.size) || 'lg')
      ;(el as any).__sigilHost = el
      return el
    },
    update(el, props) {
      el.className = 'sigil-title t-' + ((props && props.size) || 'lg')
    },
  },

  text: {
    create() {
      const el = document.createElement('p')
      el.className = 'sigil-text'
      ;(el as any).__sigilHost = el
      return el
    },
  },

  caption: {
    create() {
      const el = document.createElement('div')
      el.className = 'sigil-caption'
      ;(el as any).__sigilHost = el
      return el
    },
  },

  bold: {
    create() {
      const el = document.createElement('strong')
      ;(el as any).__sigilHost = el
      return el
    },
  },

  chip: {
    create() {
      const el = document.createElement('span')
      el.className = 'sigil-chip'
      ;(el as any).__sigilHost = el
      return el
    },
  },

  divider: {
    create() {
      const el = document.createElement('hr')
      el.className = 'sigil-divider'
      ;(el as any).__sigilHost = el
      return el
    },
  },

  slider: {
    create(props, ctx) {
      const wrap = document.createElement('label')
      wrap.className = 'sigil-slider'
      const input = document.createElement('input')
      input.type = 'range'
      const val = document.createElement('span')
      val.className = 'sigil-slider-value'
      input.addEventListener('input', () => {
        const p = (wrap as any).__sigilProps || {}
        const onChange = p.onChange as { __fn?: string } | undefined
        ctx.call(onChange && onChange.__fn, [Number(input.value)])
      })
      wrap.appendChild(input)
      wrap.appendChild(val)
      ;(wrap as any).__sigilHost = wrap
      applySlider(wrap, input, val, props)
      return wrap
    },
    update(el, props) {
      applySlider(el, el.querySelector('input')!, el.querySelector('.sigil-slider-value')!, props)
    },
  },

  checkbox: {
    create(props, ctx) {
      const wrap = document.createElement('label')
      wrap.className = 'sigil-checkbox'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.addEventListener('change', () => {
        const p = (wrap as any).__sigilProps || {}
        const onChange = p.onChange as { __fn?: string } | undefined
        ctx.call(onChange && onChange.__fn, [input.checked])
      })
      const span = document.createElement('span')
      wrap.appendChild(input)
      wrap.appendChild(span)
      ;(wrap as any).__sigilHost = span
      applyCheckbox(input, props)
      return wrap
    },
    update(el, props) {
      applyCheckbox(el.querySelector('input')!, props)
    },
  },

  button: {
    create(props, ctx) {
      const el = document.createElement('button')
      el.className = 'sigil-button' + (props && props.block ? ' block' : '')
      el.addEventListener('click', () => {
        const p = (el as any).__sigilProps || {}
        const onClick = p.onClick as { __fn?: string } | undefined
        ctx.call(onClick && onClick.__fn, [])
      })
      ;(el as any).__sigilHost = el
      return el
    },
    update(el, props) {
      el.className = 'sigil-button' + (props && props.block ? ' block' : '')
    },
  },

  barchart: {
    create(props) {
      const el = document.createElement('div')
      el.className = 'sigil-chart'
      ;(el as any).__sigilHost = el
      renderChart(el, props)
      return el
    },
    update(el, props) {
      renderChart(el, props)
    },
  },
}

export const WEB_CATALOG_TAGS: ReadonlySet<string> = new Set(CATALOG_TAGS)
