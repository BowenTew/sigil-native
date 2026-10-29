import { defineESLintConfig } from '@fetuye/eslint'

const composer = await defineESLintConfig({
  enablePrettier: true,
  enablePromise: true,
  // upstream bug: @fetuye/eslint 1.0.0 registers eslint-plugin-n rules that
  // fail to resolve ("node/handle-callback-err"); disable the node preset.
  enableNode: false,
  enableImports: true,
  enableComments: true,
  enableTypescript: true,
  enableJSX: false,
  enableVue: false,
  enableReact: false,
})

const config = await composer

const eslintConfig = [
  ...config,
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'pnpm-lock.yaml'],
  },
  {
    files: ['**/tsdown.config.ts'],
    rules: {
      // build-time-only import, provided by the workspace root
      'import/no-extraneous-dependencies': 'off',
    },
  },
]

export default eslintConfig
