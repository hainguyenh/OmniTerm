/**
 * Reclaim the renderer dev-server port before `vite` starts.
 *
 *   node scripts/free-dev-port.mjs
 *
 * `vite.config.ts` sets `strictPort: true` on 5173 because `src-tauri/tauri.conf.json` hard-codes
 * `devUrl: http://localhost:5173` — silently falling back to 5174 would leave `tauri dev` pointed at
 * nothing. The cost of that guarantee is a hard vite exit when 5173 is already taken. The common cause
 * of "already taken" is an orphaned vite from a previous `tauri dev` that the debugger tore down
 * ungracefully (the "Waiting for the debugger to disconnect..." storm), leaving its `node` child
 * still listening. This script enumerates whatever is LISTENING on 5173 and asks the OS to stop it,
 * so the next vite start succeeds instead of surfacing as
 * `beforeDevCommand terminated with a non-zero status code`.
 *
 * Best-effort and exit-0 by design: if the port is genuinely held by a server we cannot identify,
 * vite's own strictPort error is clearer than a layer-up Tauri message, so we leave that path intact.
 */

import { spawnSync } from 'node:child_process'
import { isMain } from './is-main.mjs'

/** Must match `server.port` in vite.config.ts and `devUrl` in src-tauri/tauri.conf.json. */
export const DEV_PORT = 5173

const WINDOWS = process.platform === 'win32'

/**
 * Spawn one command, portably.
 *
 * Mirrors `scripts/pre-push-check.mjs`: on Windows the same DEP0190 trap applies, so we join the
 * command line and go through a shell; elsewhere we pass an args array with no shell. Everything
 * here is built from literals (no user input), so the Windows join is safe.
 */
function spawn(command, args, options = {}) {
  return WINDOWS
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, { ...options, shell: false })
}

function parseNetstat(stdout, port) {
  const pids = new Set()
  for (const raw of stdout.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/)
    if (!parts.includes('LISTENING')) continue
    // Only the local-address cell ends with `:PORT` on a LISTENING row; the foreign cell is `:0`.
    const localIdx = parts.findIndex((token, i) => i > 0 && token.endsWith(`:${port}`))
    if (localIdx < 0) continue
    const pid = Number(parts[parts.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

function parseLsof(stdout) {
  const pids = new Set()
  for (const raw of stdout.split(/\r?\n/)) {
    const pid = Number(raw.trim())
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

/**
 * Return the PIDs of processes LISTENING on `port`, or `[]` if none (or if the OS probe failed).
 *
 * @param {number} port
 * @param {{ platform?: string, runner?: typeof spawn }} [opts]
 */
export function listListeners(port, { platform = process.platform, runner = spawn } = {}) {
  if (platform === 'win32') {
    const res = runner('netstat', ['-ano'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return []
    return parseNetstat(res.stdout, port)
  }
  // macOS and Linux lsof; terse PIDs only (one per line).
  const res = runner(
    'lsof',
    ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return []
  return parseLsof(res.stdout)
}

/**
 * Ask the OS to stop each PID. Returns the split so the caller can report honestly.
 *
 * @param {number[]} pids
 * @param {{ platform?: string, runner?: typeof spawn }} [opts]
 * @returns {{ killed: number[], failed: number[] }}
 */
export function killPids(pids, { platform = process.platform, runner = spawn } = {}) {
  const killed = []
  const failed = []
  for (const pid of pids) {
    const res = platform === 'win32'
      ? runner('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
      : runner('kill', ['-9', String(pid)], { stdio: 'ignore' })
    if (!res.error && res.status === 0) killed.push(pid)
    else failed.push(pid)
  }
  return { killed, failed }
}

/**
 * Free the dev port and log a single summary line.
 *
 * @param {{ port?: number, platform?: string, runner?: typeof spawn, log?: (...a: unknown[]) => void }} [opts]
 * @returns {{ killed: number[], failed: number[] }}
 */
export function freeDevPort({
  port = DEV_PORT,
  platform = process.platform,
  runner = spawn,
  log = console.log,
} = {}) {
  const pids = listListeners(port, { platform, runner })
  if (pids.length === 0) {
    log(`[dev-port] ${port} free`)
    return { killed: [], failed: [] }
  }
  const { killed, failed } = killPids(pids, { platform, runner })
  if (failed.length) {
    log(`[dev-port] freed ${killed.join(',') || 'none'} (kept ${failed.join(',')} — could not stop)`)
  } else {
    log(`[dev-port] freed ${killed.join(',')}`)
  }
  return { killed, failed }
}

if (isMain(import.meta.url)) {
  try {
    freeDevPort()
  } catch (error) {
    // Best-effort by design: never block `pnpm dev:frontend` from reaching vite.
    console.error(`[dev-port] ${error instanceof Error ? error.message : String(error)}`)
  }
}
