import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: 'src/index.ts',
    format: 'esm',
    dts: true,
    clean: true,
  },
  {
    // Sandbox worker bundle (runtime inlined), loaded by runner.html as a
    // classic blob worker.
    entry: 'src/worker.ts',
    format: 'iife',
    noExternal: [/^@sigil-native\//],
    dts: false,
  },
])
