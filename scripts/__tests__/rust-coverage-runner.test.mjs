import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const coverageScript = fs.readFileSync(new URL('../run-rust-coverage.mjs', import.meta.url), 'utf8')
const workflow = fs.readFileSync(new URL('../../.github/workflows/test-gate.yml', import.meta.url), 'utf8')

test('Rust coverage opts in to default --cfg=coverage injection so source-level exclusion markers fire', () => {
  // cargo-llvm-cov injects `--cfg=coverage` into RUSTFLAGS by DEFAULT; the
  // negative-only flag `--no-cfg-coverage` disables that. We omit it so
  // `#[cfg_attr(coverage, coverage(off))]` markers in crates/session-core
  // fire only during this coverage run (the markers expand to no-ops under
  // ordinary `cargo test`, where `cfg(coverage)` is off, so runtime
  // behavior stays identical). cfg(coverage_nightly) stays off everywhere.
  const matches = coverageScript.match(/const COVERAGE_BUILD_FLAGS = (\[[^\]]+\])/)
  assert.ok(matches, 'COVERAGE_BUILD_FLAGS array found in coverage script')
  const flags = JSON.parse(matches[1].replaceAll("'", '"'))
  assert.ok(!flags.includes('--no-cfg-coverage'),
    'must NOT pass --no-cfg-coverage so cargo-llvm-cov injects --cfg=coverage by default')
  assert.ok(flags.includes('--no-cfg-coverage-nightly'),
    'must keep --no-cfg-coverage-nightly to opt out of nightly cfg injection')
})

test('Rust coverage opts out of nightly cfg injection so source code stays bound to stable cfg semantics', () => {
  assert.match(coverageScript, /--no-cfg-coverage-nightly/)
})

test('Rust coverage excludes only explicit adapter paths', () => {
  assert.doesNotMatch(coverageScript, /win_job\|build\|pty\|workspace_appearance\|window_control\|os_actions\|app_utils\|connections\|lib\|main\|test_support/)
  assert.match(coverageScript, /src-tauri[^\r\n]*src[^\r\n]*win_job[^\r\n]*test_support/)
})

test('Rust binary coverage smoke runs with a virtual X display in CI', () => {
  const rustCoverageJob = workflow.slice(workflow.indexOf('  rust-coverage:'), workflow.indexOf('  coverage-gate:'))
  assert.match(rustCoverageJob, /\bxvfb\b/)
  assert.match(rustCoverageJob, /xvfb-run\s+-a\s+node scripts\/run-rust-coverage\.mjs/)
})
