// Sigil sandbox worker entry. Bundled (with the runtime inlined) into a
// classic blob worker by the host page's runner.
//
// Runs with no network access and no dynamic imports; timers are kept for
// the watchdog.

import { createSigilRuntime } from '@sigil-native/runtime'

// ---- lockdown: remove capabilities from the global scope before evaluating
// anything the model wrote.
try {
  ;(self as any).fetch = undefined
  ;(self as any).XMLHttpRequest = undefined
  ;(self as any).WebSocket = undefined
  ;(self as any).EventSource = undefined
  ;(self as any).importScripts = undefined
  ;(self as any).indexedDB = undefined
  ;(self as any).caches = undefined
} catch {
  /* ignore */
}

const runtime = createSigilRuntime(msg => self.postMessage(msg))

self.onmessage = (e: MessageEvent) => {
  const m = e.data || {}
  if (m.type === 'eval') {
    runtime.evaluate(m.code, m.constants, m.appData)
  } else if (m.type === 'event') {
    runtime.handleEvent(m.fnId, m.args)
  }
}
