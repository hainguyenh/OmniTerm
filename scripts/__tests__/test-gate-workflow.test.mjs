import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const workflow = fs.readFileSync(new URL('../../.github/workflows/test-gate.yml', import.meta.url), 'utf8')

function job(id, next) {
  const start = workflow.indexOf(`  ${id}:`)
  assert.ok(start > 0, `job ${id} exists`)
  return workflow.slice(start, workflow.indexOf(`  ${next}:`, start))
}

const rustChecks = job('rust-checks', 'rust-coverage')
const rustCoverage = job('rust-coverage', 'coverage-gate')

test('the Rust test suite runs once, inside the coverage job', () => {
  assert.match(rustChecks, /name: Rust — Clippy & Tests/)
  assert.match(rustChecks, /cargo clippy --workspace --all-targets -- -D warnings/)
  assert.doesNotMatch(rustChecks, /cargo test/)
  assert.match(rustCoverage, /run-rust-coverage\.mjs/)
})

test('the coverage build lands where rust-cache saves it', () => {
  assert.match(rustCoverage, /CARGO_TARGET_DIR: \$\{\{ github\.workspace \}\}\/target\/coverage/)
  assert.match(rustCoverage, /workspaces: \. -> target\/coverage\/llvm-cov-target/)
})

test('the coverage nightly is pinned so its cache key holds from day to day', () => {
  assert.match(rustCoverage, /toolchain: nightly-\d{4}-\d{2}-\d{2}/)
  assert.doesNotMatch(rustCoverage, /rust-toolchain@nightly/)
})

test('both Rust jobs reuse downloaded system packages per runner image', () => {
  for (const body of [rustChecks, rustCoverage]) {
    assert.match(body, /uses: actions\/cache@v\d+[\s\S]*path: ~\/apt-archives/)
    assert.match(body, /key: apt-[\w-]+-\$\{\{ runner\.os \}\}-\$\{\{ env\.ImageOS \}\}-\$\{\{ env\.ImageVersion \}\}/)
    assert.match(body, /Dir::Cache::Archives="\$HOME\/apt-archives"/)
    assert.match(body, /Acquire::Retries=3/)
  }
})
