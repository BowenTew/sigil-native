// End-to-end smoke test (no browser): parse → compile → evaluate in the real
// runtime → assert ops → simulate events → assert updates.
// Run: pnpm test

import assert from 'node:assert/strict'

import { compile } from '@sigil-native/compiler/src/codegen.ts'
import { parseSigil } from '@sigil-native/compiler/src/parser.ts'
import { CATALOG_TAGS } from '@sigil-native/lang/src/catalog.ts'
import { createSigilRuntime } from '@sigil-native/runtime/src/runtime.ts'

import type { Op, RuntimeMessage } from '@sigil-native/runtime/src/runtime.ts'

const PRICING = `## Team plan estimate

Drag the slider to see the **monthly price** for your team.

{@body const [seats, setSeats] = Sigil.useState(8)}
{@body const price = seats * 29}
<box border padding={3} gap={2}>
  <slider min={1} max={50} value={seats} onChange={setSeats}/>
  <title size="xl">\${price}/mo</title>
</box>
<text>Estimated total: **\${price * 12} /year** for {seats} seats.</text>
`

const DINNER = `## Sunday dinner plan

Lamb roast for {guests} guests.

{@body const [guests, setGuests] = Sigil.useState(6)}
{@body const dishes = [{ name: "Lamb shoulder", per: 0.4 }, { name: "Rosemary potatoes", per: 0.5 }]}
<box border padding={3} gap={2}>
  <slider min={2} max={16} value={guests} onChange={setGuests}/>
  {#each dishes as dish, i}
  <box row gap={2} padding={1}>
    <checkbox checked={dish.per * guests > 2} onChange={() => Sigil.issueNewTurn("I picked: " + dish.name)}/>
    <text>{dish.name} — {(dish.per * guests).toFixed(1)} kg</text>
  </box>
  {/each}
</box>
<button block onClick={() => Sigil.issueNewTurn("Confirm dinner for " + guests + " guests")}>Confirm menu for {guests} guests</button>
`

const DASHBOARD = `## Revenue dashboard

Switch metrics — everything runs **locally**.

{@body const [metric, setMetric] = Sigil.useState("revenue")}
{@body const months = ["Jan", "Feb", "Mar"]}
{@body const data = { revenue: [42, 55, 49], users: [120, 132, 128], churn: [3, 4, 2] }}
{@body const values = data[metric]}
<box border padding={3} gap={2}>
  <box row gap={1}>
    <button onClick={() => setMetric("revenue")}>Revenue</button>
    <button onClick={() => setMetric("users")}>Users</button>
    <button onClick={() => setMetric("churn")}>Churn</button>
  </box>
  <barchart data={values.map((v, i) => ({ label: months[i], value: v }))}/>
  <caption>Showing {metric}</caption>
  {#if metric === "churn"}
  <text>**Heads up:** churn is the share of users lost.</text>
  {/if}
</box>
`

const CATALOG = new Set<string>(CATALOG_TAGS)

function compileSource(src: string) {
  const { nodes, diagnostics } = parseSigil(src)
  return compile(nodes, { catalog: CATALOG, diagnostics })
}

function makeRuntime() {
  const posts: RuntimeMessage[] = []
  const rt = createSigilRuntime(m => posts.push(m))
  return { rt, posts }
}

function findOp(posts: RuntimeMessage[], pred: (o: Op) => boolean): Op | null {
  for (const p of posts) {
    if (p.type !== 'ops') continue
    const hit = p.ops.find(pred)
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------- 1. pricing widget
{
  const out = compileSource(PRICING)
  assert.deepEqual(out.diagnostics, [], 'full source should compile cleanly')
  assert.ok(out.code.includes('Sigil.useState(8, { key: "s0" })'), 'useState gets a stable key')

  const { rt, posts } = makeRuntime()
  rt.evaluate(out.code, out.constants)

  const slider = findOp(posts, o => o.op === 'create' && o.type === 'slider') as Extract<Op, { op: 'create' }>
  assert.ok(slider, 'slider created')
  assert.equal(slider.props!.min, 1)
  assert.equal(slider.props!.max, 50)
  assert.equal(slider.props!.value, 8)

  // interact: drag the slider to 9 — no model call, just the runtime
  const onChange = slider.props!.onChange as { __fn: string }
  rt.handleEvent(onChange.__fn, [9])

  const text261 = findOp(posts, o => o.op === 'text' && o.value === '261') // 9 * 29
  const text3132 = findOp(posts, o => o.op === 'text' && o.value === '3132') // * 12
  assert.ok(text261, 'price text updated to 261')
  assert.ok(text3132, 'yearly total updated to 3132')

  // state survives recompilation (streaming recompile keeps slider value)
  const out2 = compileSource(PRICING + '\n')
  rt.evaluate(out2.code, out2.constants)
  const setOp = findOp(posts, o => o.op === 'set' && o.props && o.props.value === 9)
  assert.ok(setOp, 'state (9) survives recompile')
  console.log('✓ pricing widget: compile, render, interact, recompile')
}

// ------------------------------------------------- 2. streaming partial input
{
  const cut = DINNER.slice(0, Math.floor(DINNER.length * 0.55)) // cut mid-stream
  const { nodes, diagnostics } = parseSigil(cut)
  assert.ok(diagnostics.length > 0, 'partial source should report repairs')
  const out = compile(nodes, { catalog: CATALOG, diagnostics })
  const { rt, posts } = makeRuntime()
  rt.evaluate(out.code, out.constants) // must not throw
  const ops = posts.filter(p => p.type === 'ops')
  assert.ok(ops.length > 0, 'partial source still renders')
  console.log(`✓ partial input: ${diagnostics.length} repairs, still renders`)
}

// --------------------------------------------------- 3. each / if / barchart
{
  const out = compileSource(DASHBOARD)
  assert.deepEqual(out.diagnostics, [])
  const { rt, posts } = makeRuntime()
  rt.evaluate(out.code, out.constants)

  const chart = findOp(posts, o => o.op === 'create' && o.type === 'barchart') as Extract<Op, { op: 'create' }>
  assert.ok(chart, 'chart created')
  assert.equal((chart.props!.data as unknown[]).length, 3)
  assert.equal((chart.props!.data as Record<string, unknown>[])[0].label, 'Jan')

  const buttons: Extract<Op, { op: 'create' }>[] = []
  for (const p of posts) {
    if (p.type !== 'ops') continue
    for (const o of p.ops)
      if (o.op === 'create' && o.type === 'button') buttons.push(o as Extract<Op, { op: 'create' }>)
  }
  assert.equal(buttons.length, 3, 'three metric buttons')

  // click "Churn" (third button) → chart data + conditional text update
  rt.handleEvent((buttons[2].props!.onClick as { __fn: string }).__fn, [])
  const chartSet = findOp(
    posts,
    o =>
      o.op === 'set' &&
      o.props &&
      Array.isArray(o.props.data) &&
      (o.props.data as Record<string, unknown>[])[0]!.value === 3,
  )
  assert.ok(chartSet, 'chart switches to churn data')
  const warnText = findOp(posts, o => JSON.stringify(o).includes('Heads up'))
  assert.ok(warnText, '{#if} block appears for churn')

  // back to revenue → conditional disappears
  rt.handleEvent((buttons[0].props!.onClick as { __fn: string }).__fn, [])
  const del = findOp(posts, o => o.op === 'delete')
  assert.ok(del, '{#if} block removed when switching back')
  console.log('✓ dashboard: {#each}, {#if}, barchart data updates')
}

// ------------------------------------------------------- 4. host action wire
{
  const out = compileSource(DINNER)
  const { rt, posts } = makeRuntime()
  rt.evaluate(out.code, out.constants)
  const checkbox = findOp(posts, o => o.op === 'create' && o.type === 'checkbox') as Extract<Op, { op: 'create' }>
  assert.ok(checkbox, 'checkbox created')
  rt.handleEvent((checkbox.props!.onChange as { __fn: string }).__fn, [true])
  const action = posts.find(
    (p): p is Extract<RuntimeMessage, { type: 'action' }> => p.type === 'action' && p.action === 'issueNewTurn',
  )
  assert.ok(action && action.text!.startsWith('I picked:'), 'Sigil.issueNewTurn reaches the host')
  console.log('✓ host actions: issueNewTurn posted to host')
}

console.log('\nAll e2e checks passed.')
