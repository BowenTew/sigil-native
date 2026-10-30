// dev: build (watch) the page bundle + the sandbox worker, then serve.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = join(here, '..')
const repoRoot = join(exampleRoot, '..', '..')

const procs = []

function run(cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
  procs.push(p)
  return p
}

// 1. engine packages (lang/runtime/compiler + web worker) in watch mode
run(
  'pnpm',
  [
    '--filter',
    '@sigil-native/lang',
    '--filter',
    '@sigil-native/compiler',
    '--filter',
    '@sigil-native/runtime',
    '--filter',
    '@sigil-native/web',
    'build',
  ],
  repoRoot,
)
// note: one-shot build is fine for the engine; iterate on the example below

// 2. the example page bundle in watch mode
run('pnpm', ['exec', 'tsdown', '-d'], exampleRoot)

// 3. the dev server
run('node', [join(here, 'serve.mjs')], exampleRoot)

function shutdown() {
  for (const p of procs) p.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
