import { describe, expect, it } from 'vitest'
import {
  analyzeBranchForCleanup,
  formatBranchTimestamp,
  formatRelativeTime,
} from '../gitBranchCleanupUtils'
import type { GitBranchInfo } from '../gitTypes'

describe('gitBranchCleanupUtils', () => {
  it('identifies gone upstream branches as high-confidence deletion candidates', () => {
    const branch: GitBranchInfo = {
      name: 'feature/pr-merged',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: true,
      last_commit_timestamp: Math.floor(Date.now() / 1000) - 86400 * 5,
    }

    const analysis = analyzeBranchForCleanup(branch, 'master')
    expect(analysis.isCandidate).toBe(true)
    expect(analysis.recommendation).toBe('high')
    expect(analysis.isProtected).toBe(false)
    expect(analysis.reasons.some((r) => r.includes('[gone]'))).toBe(true)
  })

  it('identifies fully merged branches as high-confidence deletion candidates', () => {
    const branch: GitBranchInfo = {
      name: 'feature/completed',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
      is_merged: true,
      last_commit_timestamp: Math.floor(Date.now() / 1000) - 86400 * 10,
    }

    const analysis = analyzeBranchForCleanup(branch, 'master')
    expect(analysis.isCandidate).toBe(true)
    expect(analysis.recommendation).toBe('high')
    expect(analysis.isProtected).toBe(false)
    expect(analysis.reasons.some((r) => r.includes('merged'))).toBe(true)
  })

  it('protects active current branch and default branches like master', () => {
    const currentBranch: GitBranchInfo = {
      name: 'feature/wip',
      is_current: true,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: true, // even if marked gone on server
    }

    const currentAnalysis = analyzeBranchForCleanup(currentBranch, 'feature/wip')
    expect(currentAnalysis.isProtected).toBe(true)
    expect(currentAnalysis.isCandidate).toBe(false)
    expect(currentAnalysis.recommendation).toBe('protected')

    const masterBranch: GitBranchInfo = {
      name: 'master',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
      is_merged: true,
    }

    const masterAnalysis = analyzeBranchForCleanup(masterBranch, 'feature/wip')
    expect(masterAnalysis.isProtected).toBe(true)
    expect(masterAnalysis.isCandidate).toBe(false)
  })

  it('flags stale branches older than 30 days', () => {
    const fortyDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 40
    const branch: GitBranchInfo = {
      name: 'feature/old-experiment',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
      last_commit_timestamp: fortyDaysAgo,
    }

    const analysis = analyzeBranchForCleanup(branch, 'master')
    expect(analysis.isCandidate).toBe(true)
    expect(analysis.recommendation).toBe('medium')
    expect(analysis.reasons.some((r) => r.includes('Inactive'))).toBe(true)
  })

  it('formats timestamps and relative times accurately', () => {
    expect(formatRelativeTime(undefined)).toBe('Unknown date')
    const justNow = Math.floor(Date.now() / 1000) - 30
    expect(formatRelativeTime(justNow)).toBe('Just now')

    const twoDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 2
    expect(formatRelativeTime(twoDaysAgo)).toBe('2 days ago')

    expect(formatBranchTimestamp(undefined)).toBe('No commit date')
    expect(formatBranchTimestamp(1786000000)).toContain('2026')
  })
})
