import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COVERAGE_METRICS,
  DEFAULT_BRANCH_THRESHOLD,
  RUST_IDE_FLOOR,
  combineCoverage,
  evaluateCoverage,
  normalizeJsCoverage,
  normalizeRustCoverage,
  renderMarkdown,
} from '../check-coverage.mjs'

const metric = (covered, total) => ({ covered, total, pct: total === 0 ? 100 : covered / total * 100 })

test('normalizes Istanbul/Vitest four-condition totals', () => {
  const normalized = normalizeJsCoverage({
    total: {
      lines: { covered: 90, total: 100, pct: 90 },
      statements: { covered: 88, total: 100, pct: 88 },
      functions: { covered: 17, total: 20, pct: 85 },
      branches: { covered: 34, total: 40, pct: 85 },
    },
  })
  assert.equal(normalized.language, 'JavaScript/TypeScript')
  assert.deepEqual(normalized.metrics.lines, metric(90, 100))
  assert.deepEqual(normalized.metrics.statements, metric(88, 100))
})

test('maps LLVM regions to statements and preserves branch coverage', () => {
  const normalized = normalizeRustCoverage({
    data: [{
      totals: {
        lines: { count: 100, covered: 90, percent: 90 },
        regions: { count: 120, covered: 108, percent: 90 },
        functions: { count: 20, covered: 18, percent: 90 },
        branches: { count: 50, covered: 43, percent: 86 },
      },
    }],
  })
  assert.equal(normalized.language, 'Rust')
  assert.deepEqual(normalized.metrics.statements, metric(108, 120))
  assert.deepEqual(normalized.metrics.branches, metric(43, 50))
})

test('combines languages by covered and total counts, not average percentages', () => {
  const js = {
    language: 'JavaScript/TypeScript',
    metrics: {
      lines: metric(90, 100), statements: metric(90, 100),
      functions: metric(9, 10), branches: metric(9, 10),
    },
  }
  const rust = {
    language: 'Rust',
    metrics: {
      lines: metric(10, 100), statements: metric(10, 100),
      functions: metric(1, 10), branches: metric(1, 10),
    },
  }
  const combined = combineCoverage([js, rust])
  assert.equal(combined.metrics.lines.pct, 50)
  assert.equal(combined.metrics.functions.pct, 50)
})

test('evaluation fails any language or combined metric below threshold', () => {
  const result = evaluateCoverage([
    {
      language: 'JavaScript/TypeScript',
      metrics: {
        lines: metric(90, 100), statements: metric(90, 100),
        functions: metric(90, 100), branches: metric(84, 100),
      },
    },
    {
      language: 'Rust',
      metrics: {
        lines: metric(90, 100), statements: metric(90, 100),
        functions: metric(90, 100), branches: metric(90, 100),
      },
    },
  ], 85)

  assert.equal(result.ok, false)
  assert.deepEqual(result.failures, ['JavaScript/TypeScript branches: 84.00% < 85%'])
})

const row = (language, lines, branches, llvmBranches = true) => ({
  language,
  llvmBranches,
  metrics: {
    lines: metric(lines, 100), statements: metric(lines, 100),
    functions: metric(lines, 100), branches: metric(branches, 100),
  },
})

test('only LLVM-measured branches get the lower bar; JS branches keep the full threshold', () => {
  const result = evaluateCoverage([row('JavaScript/TypeScript', 90, 82, false), row('Rust', 90, 82)], 85)
  assert.deepEqual(result.failures, ['JavaScript/TypeScript branches: 82.00% < 85%'])
  const combined = result.coverage.find((entry) => entry.language === 'Combined')
  assert.equal(combined.minimums.branches, DEFAULT_BRANCH_THRESHOLD, 'the combined row contains LLVM branches')
})

test('Rust branches default to their own lower bar while lines keep the full threshold', () => {
  const passing = evaluateCoverage([row('Rust', 85, 80)], 85)
  assert.equal(passing.branchThreshold, DEFAULT_BRANCH_THRESHOLD)
  assert.equal(passing.ok, true, passing.failures.join('; '))

  const failing = evaluateCoverage([row('Rust', 84, 79)], 85)
  assert.deepEqual(failing.failures.filter((failure) => failure.startsWith('Rust ')), [
    'Rust lines: 84.00% < 85%',
    'Rust statements: 84.00% < 85%',
    'Rust functions: 84.00% < 85%',
    'Rust branches: 79.00% < 80%',
  ])
})

test('a branch bar is never set above the overall threshold by default', () => {
  assert.equal(evaluateCoverage([row('Rust', 70, 70)], 70).branchThreshold, 70)
})

test('floored rows stay out of the combined total but fail when they drop below their floor', () => {
  const floor = { lines: 80, statements: 78, functions: 72, branches: 65 }
  const result = evaluateCoverage([row('Rust', 90, 90)], 85, {
    floored: [{ row: row('Rust IDE crates', 81, 60), floor }],
  })
  const combined = result.coverage.find((entry) => entry.language === 'Combined')
  assert.equal(combined.metrics.lines.covered, 90, 'the IDE crates are not averaged into the gate')
  assert.deepEqual(result.failures, ['Rust IDE crates branches: 60.00% < 65%'])
  assert.match(renderMarkdown(result), /Outside the gate — regression floor[\s\S]*Rust IDE crates/)
})

test('the IDE floor is a real bar for every metric', () => {
  for (const key of COVERAGE_METRICS) {
    assert.ok(RUST_IDE_FLOOR[key] >= 60 && RUST_IDE_FLOOR[key] <= 85, `${key} floor ${RUST_IDE_FLOOR[key]}`)
  }
})

test('thresholds outside 0-100 are rejected', () => {
  assert.throws(() => evaluateCoverage([row('Rust', 90, 90)], 85, { branchThreshold: 120 }), /Branch coverage threshold/)
  assert.throws(() => evaluateCoverage([row('Rust', 90, 90)], 85, {
    floored: [{ row: row('IDE', 90, 90), floor: { lines: 80, statements: 80, functions: 80 } }],
  }), /branches floor/)
})

test('Rust reports are marked as LLVM-measured; JS reports are not', () => {
  const totals = { covered: 1, count: 1, total: 1 }
  const rust = normalizeRustCoverage({ data: [{ totals: { lines: totals, regions: totals, functions: totals, branches: totals } }] })
  const js = normalizeJsCoverage({ total: { lines: totals, statements: totals, functions: totals, branches: totals } })
  assert.equal(rust.llvmBranches, true)
  assert.equal(js.llvmBranches, undefined)
})

test('normalization rejects a missing fourth condition instead of silently passing it', () => {
  assert.throws(() => normalizeRustCoverage({ data: [{ totals: {
    lines: { count: 1, covered: 1 },
    regions: { count: 1, covered: 1 },
    functions: { count: 1, covered: 1 },
  } }] }), /branches/)
})

