import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: 'src/index.ts',
    format: 'esm',
    dts: true,
    clean: true,
  },
  {
    // Plain-script global build for hosts without module machinery
    // (JavaScriptCore on iOS/macOS, classic blob workers):
    //   const rt = SigilRuntime.createSigilRuntime(post)
    entry: 'src/runtime.ts',
    format: 'iife',
    globalName: 'SigilRuntime',
    dts: false,
  },
])
