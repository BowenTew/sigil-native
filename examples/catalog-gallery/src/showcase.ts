// The showcase program: every catalog component, live state, {#if}, {#each}.
export const SHOWCASE = `## Catalog gallery

Every component in the Sigil catalog, live. **Drag, click, toggle.**

{@body const [n, setN] = Sigil.useState(4)}
{@body const [on, setOn] = Sigil.useState(true)}
{@body const bars = [{ label: "Mon", value: 12 }, { label: "Tue", value: 19 }, { label: "Wed", value: 7 }, { label: "Thu", value: 15 }]}
{@body const scaled = bars.map(b => ({ label: b.label, value: Math.round(b.value * n / 4) }))}

<box border padding={3} gap={3}>
  <title size="lg">Layout & text</title>
  <text>Regular paragraph with **bold** and an inline value: {n}.</text>
  <caption>caption · small gray text</caption>
  <box row gap={2}>
    <chip>chip one</chip>
    <chip>chip {n}</chip>
  </box>
  <divider/>
  <title size="lg">Controls</title>
  <slider min={1} max={10} value={n} onChange={setN}/>
  <box row gap={2}>
    <checkbox checked={on} onChange={(v) => setOn(v)}/>
    <text>toggle me</text>
  </box>
  <button block onClick={() => Sigil.issueNewTurn("gallery button clicked, n=" + n)}>block button (issueNewTurn)</button>
  <button onClick={() => setN(1)}>reset n</button>
  <title size="lg">Data</title>
  <barchart data={scaled}/>
  {#if on}
  <text>**{n}** — driven by slider × checkbox</text>
  {:else}
  <caption>checkbox is off → the conditional branch above is hidden</caption>
  {/if}
  {#each scaled as b, i}
  <box row gap={2}>
    <chip>{i + 1}</chip>
    <text>{b.label}: {b.value}</text>
  </box>
  {/each}
</box>
`
