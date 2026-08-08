/**
 * Preflight the toolchain and print the build sequence for OmniTerm itself.
 *
 *   node scripts/create-app.mjs [--run]
 *   pnpm create:app
 *
 * `--run` executes the build rather than just printing it.
 *
 * Note the two package-manager invocations, which are NOT interchangeable in this project: tests and
 * lint run under `corepack pnpm`, while the Tauri builds run under plain `pnpm`. This script prints them
 * exactly as they must be typed rather than normalising them, because normalising is the mistake.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { root } from './plugin-paths.mjs'

const runIt = process.argv.includes('--run')

/** Probe a tool, returning its reported version or null. */
function probe(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' })
  if (res.status !== 0 || !res.stdout) return null
  return res.stdout.trim().split('\n')[0]
}

const checks = [
  { name: 'Node.js', got: probe('node', ['--version']), need: '>=24', why: 'builds the frontend, and runs the plugin host sidecar at runtime' },
  { name: 'pnpm', got: probe('pnpm', ['--version']), need: '11.9.0', why: 'the package manager this repo pins' },
  { name: 'Rust (cargo)', got: probe('cargo', ['--version']), need: 'stable', why: 'compiles the Tauri backend' },
  { name: 'Tauri CLI', got: probe('pnpm', ['tauri', '--version']), need: 'v2', why: 'bundles the installer' },
]

console.log('\n  OmniTerm build preflight\n')
let missing = 0
for (const c of checks) {
  if (c.got) {
    console.log(`  ✓ ${c.name.padEnd(14)} ${c.got}`)
  } else {
    missing++
    console.log(`  ✗ ${c.name.padEnd(14)} not found  (need ${c.need} — ${c.why})`)
  }
}

if (!existsSync(path.join(root, 'node_modules'))) {
  console.log('\n  ! node_modules is absent — run `corepack pnpm install` first.')
}

if (missing > 0) {
  console.log(`
  ${missing} prerequisite(s) missing. Install them, then run this again.
    Node.js  https://nodejs.org  (>=24)
    Rust     https://rustup.rs
    pnpm     corepack enable && corepack prepare pnpm@11.9.0 --activate
`)
  process.exit(1)
}

const steps = [
  ['corepack pnpm install', 'install dependencies'],
  ['corepack pnpm lint', 'eslint, zero warnings tolerated'],
  ['corepack pnpm lint:tauri', 'clippy with -D warnings'],
  ['corepack pnpm test', 'the vitest suite'],
  ['corepack pnpm test:tauri', 'the Rust suite'],
  ['pnpm tauri:build', 'the installer — plain pnpm, not corepack'],
]

console.log(`
  Build sequence:
`)
for (const [cmd, why] of steps) console.log(`    ${cmd.padEnd(26)} # ${why}`)
console.log(`
  Note: tests and lint use \`corepack pnpm\`; the Tauri build uses plain \`pnpm\`.
  For a dev run instead of an installer: pnpm tauri:dev
  To scaffold a plugin:                  pnpm create:plugin <name>
`)

if (!runIt) {
  console.log('  Re-run with --run to execute the sequence above.\n')
  process.exit(0)
}

for (const [cmd] of steps) {
  console.log(`\n▸ ${cmd}`)
  const [exe, ...rest] = cmd.split(' ')
  const res = spawnSync(exe, rest, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    console.error(`\n✗ Failed: ${cmd}`)
    process.exit(res.status ?? 1)
  }
}
console.log('\n✓ Build complete. The installer is under target/release/bundle/.\n')
