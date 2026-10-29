#!/usr/bin/env node
/**
 * Local dev launcher.
 *
 *   npm run dev:all   → Vite (5173) + the AI worker (8787), together
 *   npm run api       → just the AI worker
 *
 * Starting them together means the app never silently loses its AI while the
 * UI keeps running. The worker's local state is kept on a short temp path:
 * this project sits deep enough on disk that Wrangler's default state path
 * runs past Windows' 260-character limit and workerd dies with
 * SQLITE_CANTOPEN on startup.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] ?? 'both'
const WRANGLER_STATE = join(tmpdir(), 'zk-wrangler-state')

const node = process.execPath
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

/** @type {{name: string, child: import('node:child_process').ChildProcess}[]} */
const procs = []
let shuttingDown = false

function pipe(name, stream) {
  const rl = createInterface({ input: stream })
  rl.on('line', (line) => process.stdout.write(`[${name}] ${line}\n`))
}

function start(name, args) {
  const child = spawn(node, args, { cwd: root, env: process.env, windowsHide: true })
  pipe(name, child.stdout)
  pipe(name, child.stderr)
  child.on('error', (err) => {
    process.stdout.write(`[${name}] failed to start: ${err.message}\n`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    process.stdout.write(`[${name}] stopped (${signal ?? `code ${code}`})\n`)
    shutdown(code ?? 1)
  })
  procs.push({ name, child })
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of procs) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  setTimeout(() => process.exit(code), 250)
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0))
}

if (mode === 'api') {
  start('api', [wranglerBin, 'dev', '--config', 'worker/wrangler.jsonc', '--persist-to', WRANGLER_STATE, '--port', '8787'])
} else {
  start('web', [viteBin])
  start('api', [wranglerBin, 'dev', '--config', 'worker/wrangler.jsonc', '--persist-to', WRANGLER_STATE, '--port', '8787'])
}