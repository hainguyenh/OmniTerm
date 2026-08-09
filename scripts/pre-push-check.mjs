#!/usr/bin/env node
/**
 * pre-push-check.mjs — run the Test Gate locally and refuse a push that would fail it.
 *
 * `master` now requires every Test Gate check to pass before a PR can merge, so a broken push costs
 * a full CI round trip to discover. This runs the same checks on the machine doing the pushing and
 * says, in one place, what failed and the single command that reproduces it.
 *
 * Scope: everything CI runs *except* the two coverage jobs. Rust coverage needs a nightly toolchain,
 * cargo-llvm-cov and (on Linux) a virtual X server, and takes minutes — too slow to sit in front of
 * every push. `--full` opts into them. Whatever is skipped is named in the output rather than passed
 * over silently, because a gate you believe ran and did not is worse than no gate.
 */
import { spawnSync } from 'node:child_process'

const FAST_CHECKS = [
  {
    name: 'JS — TypeScript Check',
    command: ['pnpm', 'typecheck'],
    fix: 'pnpm typecheck',
  },
  {
    name: 'JS — Lint (ESLint + LOC)',
    command: ['pnpm', 'lint'],
    fix: 'pnpm lint',
  },
  {
    name: 'JS — Unit Tests + Security Audit',
    command: ['pnpm', 'test'],
    fix: 'pnpm test',
  },
  {
    name: 'Rust — Clippy',
    command: ['cargo', 'clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'],
    fix: 'cargo clippy --workspace --all-targets -- -D warnings',
    needs: 'cargo',
  },
  {
    name: 'Rust — Unit Tests',
    command: ['cargo', 'test', '--workspace'],
    fix: 'cargo test --workspace',
    needs: 'cargo',
  },
]

const FULL_CHECKS = [
  {
    name: 'JS — Coverage (Vitest + v8)',
    command: ['pnpm', 'coverage:js'],
    fix: 'pnpm coverage:js',
  },
  {
    name: 'Rust — Coverage (llvm-cov)',
    command: ['node', 'scripts/run-rust-coverage.mjs'],
    fix: 'node scripts/run-rust-coverage.mjs',
    needs: 'cargo',
  },
  {
    name: 'Coverage — full source 85%',
    command: [
      'node', 'scripts/check-coverage.mjs',
      '--js', 'coverage-js/coverage-summary.json',
      '--rust', 'coverage-rust/coverage-summary.json',
      '--threshold', '85',
    ],
    fix: 'node scripts/check-coverage.mjs --js coverage-js/coverage-summary.json --rust coverage-rust/coverage-summary.json --threshold 85',
    needs: 'cargo',
  },
]

const WINDOWS = process.platform === 'win32'

/**
 * Run one command, portably.
 *
 * `pnpm` is a `.cmd` shim on Windows, which Node refuses to spawn without a shell. Handing spawnSync
 * an args array *and* `shell: true` is the combination that triggers DEP0190 — the args are
 * concatenated into the command line without escaping — so the Windows path passes one pre-joined
 * string and no args array instead. Every command here is built from literals in this file, so there
 * is nothing to escape; the join is safe precisely because none of it comes from user input.
 */
function spawnCheck(command, args, options = {}) {
  return WINDOWS
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, { ...options, shell: false })
}

export function isAvailable(tool, runner = spawnCheck) {
  const probe = runner(tool, ['--version'], { stdio: 'ignore' })
  return !probe.error && probe.status === 0
}

export function selectChecks({ full = false } = {}) {
  return full ? [...FAST_CHECKS, ...FULL_CHECKS] : FAST_CHECKS
}

export function parseArgs(argv) {
  const options = { full: false }
  for (const arg of argv) {
    if (arg === '--full') options.full = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

/**
 * Run each check in order, stopping at the first failure.
 *
 * Stopping early is deliberate: the first failure is nearly always the cause of the rest, and a
 * developer waiting on a push wants one command to run, not five.
 */
export function runChecks(checks, { runner = spawnCheck, log = console.log, available = isAvailable } = {}) {
  const skipped = []
  for (const check of checks) {
    if (check.needs && !available(check.needs, runner)) {
      skipped.push({ ...check, reason: `${check.needs} is not on PATH` })
      continue
    }
    log(`\n▶ ${check.name}`)
    const result = runner(check.command[0], check.command.slice(1), { stdio: 'inherit' })
    if (result.error || result.status !== 0) {
      return { ok: false, failed: check, skipped }
    }
  }
  return { ok: true, failed: null, skipped }
}

export function renderResult(result, { full }) {
  const lines = []
  for (const skip of result.skipped) {
    lines.push(`  ! skipped ${skip.name} — ${skip.reason}. CI will still run it.`)
  }
  if (!full) {
    lines.push('  ! skipped the coverage jobs (slow). Run `pnpm check:push --full` to include them.')
  }

  if (result.ok) {
    lines.unshift('', 'Pre-push checks passed.')
    if (lines.length > 1) lines.push('')
    return lines.join('\n')
  }

  return [
    '',
    'PUSH BLOCKED — a Test Gate check failed locally.',
    '',
    `  Failed: ${result.failed.name}`,
    `  Fix it with: ${result.failed.fix}`,
    '',
    ...lines,
    '',
    'Push again once it passes. Do not bypass hooks unless the repository owner',
    'explicitly authorizes that exact push.',
    '',
  ].join('\n');
}

function main() {
  if (process.env.OMNITERM_PREPUSH === 'skip') {
    console.log('Pre-push checks skipped (OMNITERM_PREPUSH=skip).')
    return
  }
  const options = parseArgs(process.argv.slice(2))
  const result = runChecks(selectChecks(options))
  const output = renderResult(result, options)
  if (result.ok) console.log(output)
  else console.error(output)
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('pre-push-check.mjs')) {
  main()
}
