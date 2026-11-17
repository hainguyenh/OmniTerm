import path from 'node:path'

import { isIdeModulePath } from './ide-modules.mjs'

const METRICS = ['branches', 'functions', 'instantiations', 'lines', 'mcdc', 'regions']

function totalsOf(files) {
  const totals = {}
  for (const metric of METRICS) {
    const summaries = files
      .map((file) => file.summary?.[metric])
      .filter((summary) => summary !== undefined)
    const count = summaries.reduce((total, summary) => total + summary.count, 0)
    const covered = summaries.reduce((total, summary) => total + summary.covered, 0)
    const total = {
      count,
      covered,
      percent: count === 0 ? 100 : (covered * 100) / count,
    }
    if (summaries.some((summary) => 'notcovered' in summary)) {
      total.notcovered = count - covered
    }
    totals[metric] = total
  }
  return totals
}

/**
 * Splits an `llvm-cov report --json --summary-only` report into the gated summary and the IDE crates
 * (`IDE_MODULE_ROOTS`), which the gate holds to a separate regression floor. Files matching
 * `excluded` (tests, dependencies, explicitly ignored adapters) are dropped from both, and each part
 * gets totals recomputed from its own files.
 */
export function splitCoverageReport(report, repoRoot, excluded) {
  const data = report?.data?.[0]
  if (!data || !Array.isArray(data.files)) {
    throw new Error('Rust coverage report is missing data[0].files')
  }
  const product = data.files.filter((file) => !excluded.test(file.filename))
  const isIde = (file) => isIdeModulePath(path.relative(repoRoot, file.filename))
  const withFiles = (files) => ({ ...report, data: [{ ...data, files, totals: totalsOf(files) }] })
  return {
    gated: withFiles(product.filter((file) => !isIde(file))),
    ide: withFiles(product.filter(isIde)),
  }
}
