import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/main.ts',
  format: 'esm',
  platform: 'browser',
  noExternal: [/^@sigil-native\//],
  outDir: 'dist',
  clean: true,
})
