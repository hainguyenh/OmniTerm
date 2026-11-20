#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './is-main.mjs'

export const COVERAGE_METRICS = Object.freeze(['lines', 'statements', 'functions', 'branches'])

// LLVM counts every `?`, match arm and short-circuit as a branch, so Rust branch coverage reads far
// below what Istanbul reports for comparable code. Rows measured by LLVM (Rust, and the combined row
// that contains it) get this lower bar for branches only; JS branches, and every other metric, keep
// the full threshold.
export const DEFAULT_BRANCH_THRESHOLD = 80

// The IDE crates (`IDE_MODULE_ROOTS` in ide-modules.mjs) keep their own conventions and sit outside
// the gate, like `ui/ide/**` in the JS coverage. They are still measured: these floors sit just under
// the coverage they had when they were split out, so a regression there fails the gate too.
export const RUST_IDE_FLOOR = Object.freeze({ lines: 80, statements: 78, functions: 72, branches: 65 })

function metricFromCounts(covered, total, label) {
  if (!Number.isFinite(covered) || !Number.isFinite(total)) {
    throw new Error(`Coverage metric ${label} must provide numeric covered and total counts`)
  }
  if (covered < 0 || total < 0 || covered > total) {
    throw new Error(`Coverage metric ${label} has invalid counts: ${covered}/${total}`)
  }
  return { covered, total, pct: total === 0 ? 100 : covered / total * 100 }
}

function requireMetric(container, key, language) {
  const raw = container?.[key]
  if (!raw) throw new Error(`${language} coverage is missing ${key}`)
  const total = raw.total ?? raw.count
  return metricFromCounts(raw.covered, total, `${language} ${key}`)
}

export function normalizeJsCoverage(report) {
  const totals = report?.total
  if (!totals) throw new Error('JavaScript/TypeScript coverage report is missing total')
  return {
    language: 'JavaScript/TypeScript',
    metrics: Object.fromEntries(
      COVERAGE_METRICS.map((key) => [key, requireMetric(totals, key, 'JavaScript/TypeScript')]),
    ),
  }
}

export function normalizeRustCoverage(report, language = 'Rust') {
  const totals = report?.data?.[0]?.totals
  if (!totals) throw new Error(`${language} coverage report is missing data[0].totals`)
  return {
    language,
    llvmBranches: true,
    metrics: {
      lines: requireMetric(totals, 'lines', language),
      statements: requireMetric(totals, 'regions', language),
      functions: requireMetric(totals, 'functions', language),
      branches: requireMetric(totals, 'branches', language),
    },
  }
}

export function combineCoverage(coverageByLanguage) {
  return {
    language: 'Combined',
    llvmBranches: coverageByLanguage.some((item) => item.llvmBranches),
    metrics: Object.fromEntries(COVERAGE_METRICS.map((key) => {
      const covered = coverageByLanguage.reduce((sum, item) => sum + item.metrics[key].covered, 0)
      const total = coverageByLanguage.reduce((sum, item) => sum + item.metrics[key].total, 0)
      return [key, metricFromCounts(covered, total, `Combined ${key}`)]
    })),
  }
}

function checkPercent(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100; got ${value}`)
  }
}

const meets = (metric, minimum) => metric.pct + Number.EPSILON >= minimum

/**
 * Gated rows (each language and their combination) must reach `threshold` on every metric, except
 * LLVM-measured branches, which must reach `branchThreshold`. Floored rows are measured outside the
 * gate and only have to stay above their floor.
 */
export function evaluateCoverage(coverageByLanguage, threshold = 85, options = {}) {
  const { branchThreshold = Math.min(threshold, DEFAULT_BRANCH_THRESHOLD), floored = [] } = options
  checkPercent(threshold, 'Coverage threshold')
  checkPercent(branchThreshold, 'Branch coverage threshold')
  const gateMinimums = (row) => Object.fromEntries(COVERAGE_METRICS.map((key) => [
    key,
    key === 'branches' && row.llvmBranches ? branchThreshold : threshold,
  ]))
  const rows = [...coverageByLanguage, combineCoverage(coverageByLanguage)]
    .map((row) => ({ ...row, minimums: gateMinimums(row) }))
  for (const { row, floor } of floored) {
    for (const key of COVERAGE_METRICS) checkPercent(floor[key], `${row.language} ${key} floor`)
    rows.push({ ...row, minimums: floor, floored: true })
  }
  const failures = []

  for (const row of rows) {
    for (const key of COVERAGE_METRICS) {
      const metric = row.metrics[key]
      if (!meets(metric, row.minimums[key])) {
        failures.push(`${row.language} ${key}: ${metric.pct.toFixed(2)}% < ${row.minimums[key]}%`)
      }
    }
  }

  return { ok: failures.length === 0, threshold, branchThreshold, coverage: rows, failures }
}

function coverageTable(rows) {
  const header = '| Scope | Lines | Statements/Regions | Functions | Branches | Result |'
  const separator = '|---|---:|---:|---:|---:|:---:|'
  const body = rows.map((row) => {
    const cells = COVERAGE_METRICS.map((key) => {
      const metric = row.metrics[key]
      return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total}) ≥ ${row.minimums[key]}%`
    })
    const pass = COVERAGE_METRICS.every((key) => meets(row.metrics[key], row.minimums[key]))
    return `| ${row.language} | ${cells.join(' | ')} | ${pass ? 'PASS' : 'FAIL'} |`
  })
  return `${header}\n${separator}\n${body.join('\n')}`
}

export function renderMarkdown(result) {
  const gated = result.coverage.filter((row) => !row.floored)
  const floored = result.coverage.filter((row) => row.floored)
  const floorSection = floored.length
    ? `\n\n### Outside the gate — regression floor\n\n${coverageTable(floored)}`
    : ''
  const failures = result.failures.length
    ? `\n\n### Coverage failures\n${result.failures.map((failure) => `- ${failure}`).join('\n')}`
    : '\n\nAll language, combined and floor coverage conditions passed.'
  const title = `## Coverage gate — ${result.threshold}% minimum, Rust branches ${result.branchThreshold}%`
  return `${title}\n\n${coverageTable(gated)}${floorSection}${failures}\n`
}

function parseArgs(argv) {
  const options = { threshold: 85 }
  const valueArgs = new Set(['--js', '--rust', '--rust-ide', '--threshold', '--branch-threshold', '--output'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!valueArgs.has(arg)) throw new Error(`Unknown argument: ${arg}`)
    const value = argv[++index]
    if (!value) throw new Error(`Missing value for ${arg}`)
    if (arg === '--threshold') options.threshold = Number(value)
    else if (arg === '--branch-threshold') options.branchThreshold = Number(value)
    else options[arg.slice(2).replaceAll('-', '_')] = value
  }
  if (!options.js || !options.rust) {
    throw new Error(
      'Usage: node scripts/check-coverage.mjs --js <json> --rust <json> [--rust-ide <json>]'
      + ' [--threshold 85] [--branch-threshold 80] [--output result.json]',
    )
  }
  return options
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const coverage = [
    normalizeJsCoverage(await readJson(options.js)),
    normalizeRustCoverage(await readJson(options.rust)),
  ]
  const floored = options.rust_ide
    ? [{ row: normalizeRustCoverage(await readJson(options.rust_ide), 'Rust IDE crates'), floor: RUST_IDE_FLOOR }]
    : []
  const result = evaluateCoverage(coverage, options.threshold, { branchThreshold: options.branchThreshold, floored })
  const markdown = renderMarkdown(result)

  process.stdout.write(markdown)
  if (options.output) await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  if (!result.ok) process.exitCode = 1
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
