#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const COVERAGE_METRICS = Object.freeze(['lines', 'statements', 'functions', 'branches'])

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

export function normalizeRustCoverage(report) {
  const totals = report?.data?.[0]?.totals
  if (!totals) throw new Error('Rust coverage report is missing data[0].totals')
  return {
    language: 'Rust',
    metrics: {
      lines: requireMetric(totals, 'lines', 'Rust'),
      statements: requireMetric(totals, 'regions', 'Rust'),
      functions: requireMetric(totals, 'functions', 'Rust'),
      branches: requireMetric(totals, 'branches', 'Rust'),
    },
  }
}

export function combineCoverage(coverageByLanguage) {
  return {
    language: 'Combined',
    metrics: Object.fromEntries(COVERAGE_METRICS.map((key) => {
      const covered = coverageByLanguage.reduce((sum, item) => sum + item.metrics[key].covered, 0)
      const total = coverageByLanguage.reduce((sum, item) => sum + item.metrics[key].total, 0)
      return [key, metricFromCounts(covered, total, `Combined ${key}`)]
    })),
  }
}

export function evaluateCoverage(coverageByLanguage, threshold = 85) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`Coverage threshold must be between 0 and 100; got ${threshold}`)
  }
  const combined = combineCoverage(coverageByLanguage)
  const rows = [...coverageByLanguage, combined]
  const failures = []

  for (const row of rows) {
    for (const key of COVERAGE_METRICS) {
      const { pct } = row.metrics[key]
      if (pct + Number.EPSILON < threshold) {
        failures.push(`${row.language} ${key}: ${pct.toFixed(2)}% < ${threshold}%`)
      }
    }
  }

  return { ok: failures.length === 0, threshold, coverage: rows, failures }
}

export function renderMarkdown(result) {
  const header = '| Language | Lines | Statements/Regions | Functions | Branches | Result |'
  const separator = '|---|---:|---:|---:|---:|:---:|'
  const rows = result.coverage.map((item) => {
    const cells = COVERAGE_METRICS.map((key) => {
      const metric = item.metrics[key]
      return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`
    })
    const passed = COVERAGE_METRICS.every((key) => item.metrics[key].pct + Number.EPSILON >= result.threshold)
    return `| ${item.language} | ${cells.join(' | ')} | ${passed ? 'PASS' : 'FAIL'} |`
  })
  const failures = result.failures.length
    ? `\n\n### Coverage failures\n${result.failures.map((failure) => `- ${failure}`).join('\n')}`
    : '\n\nAll language and combined coverage conditions passed.'
  return `## Coverage gate — ${result.threshold}% minimum\n\n${header}\n${separator}\n${rows.join('\n')}${failures}\n`
}

function parseArgs(argv) {
  const options = { threshold: 85 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--js') options.js = argv[++index]
    else if (arg === '--rust') options.rust = argv[++index]
    else if (arg === '--threshold') options.threshold = Number(argv[++index])
    else if (arg === '--output') options.output = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.js || !options.rust) {
    throw new Error('Usage: node scripts/check-coverage.mjs --js <coverage-summary.json> --rust <rust-coverage.json> [--threshold 85] [--output result.json]')
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
  const result = evaluateCoverage(coverage, options.threshold)
  const markdown = renderMarkdown(result)
  process.stdout.write(markdown)

  if (options.output) await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  if (!result.ok) process.exitCode = 1
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
