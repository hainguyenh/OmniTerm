import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COVERAGE_METRICS,
  combineCoverage,
  evaluateCoverage,
  normalizeJsCoverage,
  normalizeRustCoverage,
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

test('normalization rejects a missing fourth condition instead of silently passing it', () => {
  assert.throws(() => normalizeRustCoverage({ data: [{ totals: {
    lines: { count: 1, covered: 1 },
    regions: { count: 1, covered: 1 },
    functions: { count: 1, covered: 1 },
  } }] }), /branches/)
})

