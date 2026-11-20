import assert from 'node:assert/strict'
import test from 'node:test'

import { splitCoverageReport } from '../rust-coverage-summary.mjs'

const ROOT = '/repo'
const EXCLUDED = /(?:^|\/)(?:tests?\/|[^/]+_tests?\.rs$)|cargo\/registry|^\/rustc\//
const file = (filename, covered, count) => ({
  filename,
  summary: { lines: { count, covered }, branches: { count, covered, notcovered: count - covered } },
})

const report = {
  type: 'llvm.coverage.json.export',
  data: [{
    files: [
      file('/repo/src-tauri/src/pty_bridge.rs', 9, 10),
      file('/repo/crates/app-core/src/safepath.rs', 8, 10),
      file('/repo/crates/ide-host/src/project.rs', 5, 10),
      file('/repo/plugins/official/todo-finder/src/lib.rs', 1, 10),
      file('/repo/crates/app-core/src/safepath_tests.rs', 0, 10),
      file('/home/runner/.cargo/registry/src/serde/lib.rs', 0, 10),
      file('/rustc/5df8c02af/library/core/src/option.rs', 0, 10),
    ],
    totals: {},
  }],
}

test('product files outside the IDE module roots form the gated summary', () => {
  const { gated } = splitCoverageReport(report, ROOT, EXCLUDED)
  assert.deepEqual(gated.data[0].files.map((entry) => entry.filename), [
    '/repo/src-tauri/src/pty_bridge.rs',
    '/repo/crates/app-core/src/safepath.rs',
  ])
  assert.deepEqual(gated.data[0].totals.lines, { count: 20, covered: 17, percent: 85 })
  assert.equal(gated.data[0].totals.branches.notcovered, 3)
})

test('IDE crates and plugins are measured separately, never dropped', () => {
  const { ide } = splitCoverageReport(report, ROOT, EXCLUDED)
  assert.deepEqual(ide.data[0].files.map((entry) => entry.filename), [
    '/repo/crates/ide-host/src/project.rs',
    '/repo/plugins/official/todo-finder/src/lib.rs',
  ])
  assert.deepEqual(ide.data[0].totals.lines, { count: 20, covered: 6, percent: 30 })
})

test('tests, dependencies and inlined standard library code count in neither part', () => {
  const { gated, ide } = splitCoverageReport(report, ROOT, EXCLUDED)
  const all = [...gated.data[0].files, ...ide.data[0].files].map((entry) => entry.filename)
  assert.ok(!all.some((name) => /_tests\.rs$|registry|^\/rustc\//.test(name)), all.join(', '))
})

test('a report without per-file data is rejected instead of passing empty', () => {
  assert.throws(() => splitCoverageReport({ data: [{}] }, ROOT, EXCLUDED), /data\[0\]\.files/)
})
