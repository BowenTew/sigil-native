import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/main.ts',
  format: 'esm',
  platform: 'browser',
  // bundle the engine into the page bundle; the sandboxed runtime stays
  // separate (renderers/web dist/worker.iife.js, loaded by the runner)
  noExternal: [/^@sigil-native\//],
  outDir: 'dist',
  clean: true,
})
