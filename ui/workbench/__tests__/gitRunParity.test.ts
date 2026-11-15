import { describe, expect, it } from 'vitest'

import { isTestForkBanner } from '../../ide/features/run/javaDebug'
import { protectedBranchProblem } from '../../ide/features/vcs/rebasePlan'

describe('protectedBranchProblem', () => {
  const protectedMain = (name: string) => name === 'main'

  it('refuses rewriting pushed commits of a protected branch', () => {
    expect(protectedBranchProblem({ head: 'main', upstream: 'origin/main' }, protectedMain)).toBe(
      "Pushed commits of the protected branch 'main' cannot be rewritten",
    )
  })

  it('allows an unprotected branch, a branch without upstream and a detached head', () => {
    expect(protectedBranchProblem({ head: 'feat', upstream: 'origin/feat' }, protectedMain)).toBeNull()
    expect(protectedBranchProblem({ head: 'main', upstream: null }, protectedMain)).toBeNull()
    expect(protectedBranchProblem({ head: null, upstream: null }, protectedMain)).toBeNull()
  })
})

describe('isTestForkBanner', () => {
  // Imported with the file, not inside the test: under a full parallel run, loading the run
  // feature's module graph inside the test body used to exceed the 15s test timeout.
  it('recognizes the banner Surefire prints before it forks the test JVM, coloured or not', () => {
    expect(isTestForkBanner('[INFO]  T E S T S')).toBe(true)
    expect(isTestForkBanner('[\x1b[1;34mINFO\x1b[m]  T E S T S')).toBe(true)
    expect(isTestForkBanner('[INFO] Tests run: 1, Failures: 0')).toBe(false)
  })
})
