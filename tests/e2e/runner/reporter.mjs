/**
 * Colorized console reporter for OmniTerm E2E test runner.
 */

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export class ConsoleReporter {
  constructor({ verbose = false } = {}) {
    this.verbose = verbose
    this.failures = []
  }

  onSuiteStart(suiteName) {
    console.log(`\n${ANSI.bold}${ANSI.cyan}▶ Suite: ${suiteName}${ANSI.reset}`)
  }

  onTestPass(testCase, durationMs) {
    const tierBadge = `${ANSI.dim}[T${testCase.tier}]${ANSI.reset}`
    const durBadge = `${ANSI.gray}(${durationMs}ms)${ANSI.reset}`
    console.log(`  ${ANSI.green}✔ PASS${ANSI.reset} ${tierBadge} ${testCase.name} ${durBadge}`)
  }

  onTestFail(testCase, error, durationMs) {
    const tierBadge = `${ANSI.dim}[T${testCase.tier}]${ANSI.reset}`
    const durBadge = `${ANSI.red}(${durationMs}ms)${ANSI.reset}`
    console.log(`  ${ANSI.red}✖ FAIL${ANSI.reset} ${tierBadge} ${testCase.name} ${durBadge}`)
    this.failures.push({ testCase, error })
  }

  onTestSkip(testCase) {
    if (this.verbose) {
      const tierBadge = `${ANSI.dim}[T${testCase.tier}]${ANSI.reset}`
      console.log(`  ${ANSI.yellow}⊘ SKIP${ANSI.reset} ${tierBadge} ${testCase.name}`)
    }
  }

  onSuiteEnd(suiteResult) {
    const summary = `${suiteResult.passed} passed, ${suiteResult.failed} failed, ${suiteResult.skipped} skipped`
    console.log(`  ${ANSI.dim}↳ ${summary} in ${suiteResult.durationMs}ms${ANSI.reset}`)
  }

  onRunEnd(results) {
    console.log('\n' + '='.repeat(60))
    console.log(`${ANSI.bold} OmniTerm IDE E2E Test Execution Summary${ANSI.reset}`)
    console.log('='.repeat(60))

    if (this.failures.length > 0) {
      console.log(`\n${ANSI.bold}${ANSI.red}Failures & Stack Traces (${this.failures.length}):${ANSI.reset}\n`)
      this.failures.forEach(({ testCase, error }, idx) => {
        console.log(`${ANSI.red}${idx + 1}) [Tier ${testCase.tier}] ${testCase.name}${ANSI.reset}`)
        console.log(`${ANSI.gray}${error?.stack || error?.message || error}${ANSI.reset}\n`)
      })
    }

    const durationSec = (results.durationMs / 1000).toFixed(2)

    console.log(`Total Suites:     ${results.totalSuites}`)
    console.log(`Total Test Cases: ${results.totalTests}`)
    console.log(`Passed:           ${ANSI.green}${results.passed}${ANSI.reset}`)
    console.log(`Failed:           ${results.failed > 0 ? ANSI.red : ANSI.gray}${results.failed}${ANSI.reset}`)
    console.log(`Skipped:          ${results.skipped > 0 ? ANSI.yellow : ANSI.gray}${results.skipped}${ANSI.reset}`)
    console.log(`Total Duration:   ${durationSec}s`)
    console.log('-'.repeat(60))

    if (results.failed === 0) {
      console.log(`${ANSI.bold}${ANSI.green}STATUS: SUCCESS — All executed tests passed!${ANSI.reset}\n`)
    } else {
      console.log(`${ANSI.bold}${ANSI.red}STATUS: FAILURE — ${results.failed} test(s) failed.${ANSI.reset}\n`)
    }
  }
}
