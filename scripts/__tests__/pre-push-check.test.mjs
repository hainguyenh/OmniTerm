import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAvailable,
  parseArgs,
  renderResult,
  runChecks,
  selectChecks,
} from '../pre-push-check.mjs'

/** A spawnSync stand-in: answers `--version` probes, and fails whichever command is named. */
function fakeRunner({ failing = null, missing = [], calls = [] } = {}) {
  return (command, args) => {
    if (args[0] === '--version') {
      return missing.includes(command) ? { status: 1 } : { status: 0 }
    }
    calls.push([command, ...args].join(' '))
    return { status: command === failing ? 1 : 0 }
  }
}

test('parseArgs defaults to the fast checks and accepts --full', () => {
  assert.deepEqual(parseArgs([]), { full: false })
  assert.deepEqual(parseArgs(['--full']), { full: true })
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/)
})

test('--full adds the coverage jobs the fast run leaves out', () => {
  const fast = selectChecks().map((c) => c.name)
  const full = selectChecks({ full: true }).map((c) => c.name)
  assert.ok(!fast.some((name) => name.includes('Coverage')))
  assert.ok(full.includes('Coverage — full source 85%'))
  assert.ok(full.length > fast.length)
})

test('a passing run reports every check it actually ran', () => {
  const calls = []
  const result = runChecks(selectChecks(), { runner: fakeRunner({ calls }), log: () => {} })
  assert.equal(result.ok, true)
  assert.equal(result.failed, null)
  assert.deepEqual(result.skipped, [])
  assert.ok(calls.some((c) => c.startsWith('cargo clippy')))
  assert.ok(calls.some((c) => c.includes('pnpm test')))
})

test('the first failure stops the run and names the command that reproduces it', () => {
  const calls = []
  const result = runChecks(selectChecks(), {
    runner: fakeRunner({ failing: 'pnpm', calls }),
    log: () => {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.failed.name, 'JS — TypeScript Check')
  assert.equal(result.failed.fix, 'pnpm typecheck')
  // Nothing after the failure should have run — the first failure is usually the cause of the rest.
  assert.ok(!calls.some((c) => c.startsWith('cargo')))
})

test('a missing toolchain is skipped loudly, never silently passed', () => {
  const result = runChecks(selectChecks(), {
    runner: fakeRunner({ missing: ['cargo'] }),
    log: () => {},
  })
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.skipped.map((s) => s.name),
    ['Rust — Clippy', 'Rust — Unit Tests'],
  )
  const output = renderResult(result, { full: false })
  assert.match(output, /skipped Rust — Clippy/)
  assert.match(output, /CI will still run it/)
})

test('isAvailable reports whether a tool answers --version', () => {
  assert.equal(isAvailable('cargo', fakeRunner()), true)
  assert.equal(isAvailable('cargo', fakeRunner({ missing: ['cargo'] })), false)
  assert.equal(isAvailable('cargo', () => ({ error: new Error('ENOENT') })), false)
})

test('a blocked push explains what failed, how to fix it, and how to override', () => {
  const result = runChecks(selectChecks(), { runner: fakeRunner({ failing: 'cargo' }), log: () => {} })
  const output = renderResult(result, { full: false })
  assert.match(output, /PUSH BLOCKED/)
  assert.match(output, /Failed: Rust — Clippy/)
  assert.match(output, /Fix it with: cargo clippy --workspace --all-targets -- -D warnings/)
  assert.match(output, /git push --no-verify/)
})

test('a passing fast run still says the coverage jobs were not run', () => {
  const result = runChecks(selectChecks(), { runner: fakeRunner(), log: () => {} })
  const passed = renderResult(result, { full: false })
  assert.match(passed, /Pre-push checks passed/)
  assert.match(passed, /skipped the coverage jobs/)
  // With --full there is nothing left to warn about.
  assert.doesNotMatch(renderResult(result, { full: true }), /skipped the coverage jobs/)
})
