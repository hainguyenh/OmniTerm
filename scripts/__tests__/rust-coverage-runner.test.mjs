import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const coverageScript = fs.readFileSync(new URL('../run-rust-coverage.mjs', import.meta.url), 'utf8')
const workflow = fs.readFileSync(new URL('../../.github/workflows/test-gate.yml', import.meta.url), 'utf8')

test('Rust coverage opts out of cargo-llvm-cov cfg injection', () => {
  assert.match(coverageScript, /--no-cfg-coverage/)
  assert.match(coverageScript, /--no-cfg-coverage-nightly/)
})

test('Rust binary coverage smoke runs with a virtual X display in CI', () => {
  const rustCoverageJob = workflow.slice(workflow.indexOf('  rust-coverage:'), workflow.indexOf('  coverage-gate:'))
  assert.match(rustCoverageJob, /\bxvfb\b/)
  assert.match(rustCoverageJob, /xvfb-run\s+-a\s+node scripts\/run-rust-coverage\.mjs/)
})
