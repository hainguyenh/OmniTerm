import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  analyzeBranchForCleanup,
  formatBranchTimestamp,
  formatRelativeTime,
} from '../gitBranchCleanupUtils'
import type { GitBranchInfo } from '../gitTypes'

const NOW_SEC = 1_800_000_000
const DAY = 86400

const branch = (overrides: Partial<GitBranchInfo>): GitBranchInfo => ({
  name: 'feature/x',
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
  ...overrides,
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SEC * 1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [undefined, 'Unknown date'],
    [NOW_SEC - 30, 'Just now'],
    [NOW_SEC + 500, 'Just now'],
    [NOW_SEC - 60 * 5, '5 minutes ago'],
    [NOW_SEC - 3600, '1 hour ago'],
    [NOW_SEC - 3600 * 5, '5 hours ago'],
    [NOW_SEC - DAY, 'Yesterday'],
    [NOW_SEC - DAY * 12, '12 days ago'],
    [NOW_SEC - DAY * 30, '1 month ago'],
    [NOW_SEC - DAY * 95, '3 months ago'],
    [NOW_SEC - DAY * 365, '1 year ago'],
    [NOW_SEC - DAY * 800, '2 years ago'],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatRelativeTime(timestamp)).toBe(expected)
  })
})

describe('formatBranchTimestamp', () => {
  it('reports a missing timestamp', () => {
    expect(formatBranchTimestamp(undefined)).toBe('No commit date')
  })

  it('formats the commit year for a known timestamp', () => {
    expect(formatBranchTimestamp(NOW_SEC)).toContain('2027')
  })
})

describe('analyzeBranchForCleanup', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SEC * 1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('protects primary branch names case-insensitively', () => {
    const analysis = analyzeBranchForCleanup(branch({ name: 'Develop', is_gone: true }))
    expect(analysis.isProtected).toBe(true)
    expect(analysis.recommendation).toBe('protected')
    expect(analysis.primaryReason).toBe('Primary default branch (Develop)')
    expect(analysis.daysOld).toBeNull()
  })

  it('protects the branch named as current even when the flag is unset', () => {
    const analysis = analyzeBranchForCleanup(branch({ name: 'feature/x' }), 'feature/x')
    expect(analysis.reasons).toEqual(['Current active branch'])
    expect(analysis.isCandidate).toBe(false)
  })

  it('keeps recently active branches without cleanup signals', () => {
    const analysis = analyzeBranchForCleanup(
      branch({ last_commit_timestamp: NOW_SEC - DAY * 2, ahead: 3, behind: 1 }),
    )
    expect(analysis.recommendation).toBe('safe')
    expect(analysis.isCandidate).toBe(false)
    expect(analysis.reasons).toEqual([])
    expect(analysis.primaryReason).toBe('Active branch with recent unmerged work')
    expect(analysis.daysOld).toBe(2)
  })

  it('marks branches behind upstream with no local work as medium candidates', () => {
    const analysis = analyzeBranchForCleanup(branch({ behind: 4 }))
    expect(analysis.recommendation).toBe('medium')
    expect(analysis.isCandidate).toBe(true)
    expect(analysis.primaryReason).toBe('Behind remote by 4 commit(s) with 0 unpushed changes')
  })

  it('marks inactive branches as medium candidates', () => {
    const analysis = analyzeBranchForCleanup(branch({ last_commit_timestamp: NOW_SEC - DAY * 45 }))
    expect(analysis.recommendation).toBe('medium')
    expect(analysis.primaryReason).toBe('Inactive for 45 days (last commit: 1 month ago)')
  })

  it('ranks merged or gone branches as high and lists every reason', () => {
    const analysis = analyzeBranchForCleanup(
      branch({ is_merged: true, is_gone: true, behind: 2, last_commit_timestamp: NOW_SEC - DAY * 40 }),
    )
    expect(analysis.recommendation).toBe('high')
    expect(analysis.reasons).toHaveLength(4)
    expect(analysis.primaryReason).toBe('Remote tracking branch deleted on server ([gone])')
  })

  it('ranks a merged-only branch as high', () => {
    const analysis = analyzeBranchForCleanup(branch({ is_merged: true, ahead: 1 }))
    expect(analysis.recommendation).toBe('high')
    expect(analysis.reasons).toEqual(['Branch commits are fully merged'])
  })
})
