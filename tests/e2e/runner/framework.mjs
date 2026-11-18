// Copyright (c) 2026
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimalist, robust E2E test runner framework for OmniTerm.
 * Provides describe, test/it, lifecycle hooks, tier filtering, and runner execution.
 */

class TestContext {
  constructor() {
    this.suites = []
    this.currentSuite = null
    this.beforeAllHooks = []
    this.afterAllHooks = []
  }

  reset() {
    this.suites = []
    this.currentSuite = null
    this.beforeAllHooks = []
    this.afterAllHooks = []
  }
}

const context = new TestContext()

export function describe(name, fn) {
  const suite = {
    name,
    tests: [],
    beforeEachHooks: [],
    afterEachHooks: [],
    beforeAllHooks: [],
    afterAllHooks: [],
  }

  const prevSuite = context.currentSuite
  context.currentSuite = suite
  context.suites.push(suite)

  try {
    fn()
  } finally {
    context.currentSuite = prevSuite
  }
}

export function test(name, fnOrOptions, optionsOrFn = {}) {
  let fn = fnOrOptions
  let options = optionsOrFn
  if (typeof fnOrOptions === 'object' && typeof optionsOrFn === 'function') {
    fn = optionsOrFn
    options = fnOrOptions
  }
  const activeSuite = context.currentSuite || getOrCreateDefaultSuite()
  activeSuite.tests.push({
    name,
    fn,
    tier: options.tier ?? 1,
    timeout: options.timeout ?? 10000,
    skip: Boolean(options.skip),
    only: Boolean(options.only),
  })
}

export const it = test

export function beforeEach(fn) {
  if (context.currentSuite) {
    context.currentSuite.beforeEachHooks.push(fn)
  }
}

export function afterEach(fn) {
  if (context.currentSuite) {
    context.currentSuite.afterEachHooks.push(fn)
  }
}

export function beforeAll(fn) {
  if (context.currentSuite) {
    context.currentSuite.beforeAllHooks.push(fn)
  } else {
    context.beforeAllHooks.push(fn)
  }
}

export function afterAll(fn) {
  if (context.currentSuite) {
    context.currentSuite.afterAllHooks.push(fn)
  } else {
    context.afterAllHooks.push(fn)
  }
}

function getOrCreateDefaultSuite() {
  let defaultSuite = context.suites.find((s) => s.name === 'Default Suite')
  if (!defaultSuite) {
    defaultSuite = {
      name: 'Default Suite',
      tests: [],
      beforeEachHooks: [],
      afterEachHooks: [],
      beforeAllHooks: [],
      afterAllHooks: [],
    }
    context.suites.push(defaultSuite)
  }
  return defaultSuite
}

export async function runTests({ tier = 'all', filter = null, reporter } = {}) {
  const results = {
    totalSuites: context.suites.length,
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    suites: [],
  }

  const startAll = Date.now()

  // Run global beforeAll hooks
  for (const hook of context.beforeAllHooks) {
    await hook()
  }

  for (const suite of context.suites) {
    const suiteResult = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
    }

    const startSuite = Date.now()
    reporter?.onSuiteStart?.(suite.name)

    // Run suite beforeAll hooks
    for (const hook of suite.beforeAllHooks) {
      await hook()
    }

    for (const testCase of suite.tests) {
      results.totalTests++

      // Tier check
      const tierMatch =
        tier === 'all' ||
        String(testCase.tier) === String(tier) ||
        (Array.isArray(tier) && tier.includes(String(testCase.tier)))

      // Filter check
      const filterMatch = !filter || new RegExp(filter, 'i').test(`${suite.name} ${testCase.name}`)

      if (!tierMatch || !filterMatch || testCase.skip) {
        suiteResult.skipped++
        results.skipped++
        suiteResult.tests.push({
          name: testCase.name,
          tier: testCase.tier,
          status: 'skipped',
          durationMs: 0,
        })
        reporter?.onTestSkip?.(testCase)
        continue
      }

      // Run beforeEach hooks
      for (const hook of suite.beforeEachHooks) {
        await hook()
      }

      const startTest = Date.now()
      let testError = null

      try {
        await Promise.race([
          testCase.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Test timed out after ${testCase.timeout}ms`)), testCase.timeout),
          ),
        ])
      } catch (err) {
        testError = err
      }

      const durationMs = Date.now() - startTest

      // Run afterEach hooks
      for (const hook of suite.afterEachHooks) {
        try {
          await hook()
        } catch (hookErr) {
          if (!testError) testError = hookErr
        }
      }

      if (testError) {
        suiteResult.failed++
        results.failed++
        suiteResult.tests.push({
          name: testCase.name,
          tier: testCase.tier,
          status: 'failed',
          durationMs,
          error: testError,
        })
        reporter?.onTestFail?.(testCase, testError, durationMs)
      } else {
        suiteResult.passed++
        results.passed++
        suiteResult.tests.push({
          name: testCase.name,
          tier: testCase.tier,
          status: 'passed',
          durationMs,
        })
        reporter?.onTestPass?.(testCase, durationMs)
      }
    }

    // Run suite afterAll hooks
    for (const hook of suite.afterAllHooks) {
      await hook()
    }

    suiteResult.durationMs = Date.now() - startSuite
    results.suites.push(suiteResult)
    reporter?.onSuiteEnd?.(suiteResult)
  }

  // Run global afterAll hooks
  for (const hook of context.afterAllHooks) {
    await hook()
  }

  results.durationMs = Date.now() - startAll
  reporter?.onRunEnd?.(results)
  return results
}

export function resetFramework() {
  context.reset()
}
