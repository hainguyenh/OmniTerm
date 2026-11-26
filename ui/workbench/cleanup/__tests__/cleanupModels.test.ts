import { describe, expect, it } from 'vitest'

import { readStoredRoots } from '../cleanupRootsStore'
import { applyCleanResults, freeable, idleDays, idleTargets, parseCleanResults, parseRustTarget, type RustTarget } from '../rustCleanupModel'
import { parseRemoveReport, parseWorktreeEntry, sortWorktrees, suggest, type WorktreeEntry } from '../worktreeCleanupModel'

const NOW = Date.UTC(2026, 10, 26)
const DAY = 86_400_000

const target = (name: string, bytes: number, incrementalBytes: number, builtDaysAgo: number): RustTarget => ({
  project: `D:/code/${name}`,
  name,
  target: `D:/code/${name}/target`,
  files: 10,
  bytes,
  incrementalBytes,
  lastBuild: Math.floor((NOW - builtDaysAgo * DAY) / 1000),
})

const worktree = (patch: Partial<WorktreeEntry>): WorktreeEntry => ({
  path: 'D:/code/app-fix',
  repo: 'D:/code/app',
  repoName: 'app',
  branch: 'fix',
  head: 'abc123',
  locked: false,
  missing: false,
  changes: 0,
  lastActiveMs: NOW - DAY,
  upstream: 'origin/fix',
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  base: 'master',
  merged: false,
  bytes: 1000,
  ...patch,
})

describe('the Rust clean-up model', () => {
  it('validates build folders and results from the backend', () => {
    const raw = target('app', 500, 100, 3)
    expect(parseRustTarget(raw)).toEqual(raw)
    expect(parseRustTarget({ ...raw, bytes: -1 })).toBeNull()
    expect(parseRustTarget({ ...raw, target: '' })).toBeNull()
    expect(parseRustTarget(null)).toBeNull()
    expect(parseCleanResults([{ target: 't', freedBytes: 5, error: null }, { target: '', freedBytes: 1 }, 'x'])).toEqual([
      { target: 't', freedBytes: 5, error: null },
    ])
    expect(parseCleanResults('nope')).toEqual([])
  })

  it('filters by the days since the last build and sums what a mode frees', () => {
    const targets = [target('fresh', 500, 100, 1), target('old', 900, 300, 40)]
    expect(idleDays(targets[1], NOW)).toBe(40)
    expect(idleTargets(targets, 0, NOW)).toHaveLength(2)
    expect(idleTargets(targets, 30, NOW).map((t) => t.name)).toEqual(['old'])
    const both = new Set(targets.map((t) => t.target))
    expect(freeable(targets, both, 'incremental')).toBe(400)
    expect(freeable(targets, both, 'all')).toBe(1400)
    expect(freeable(targets, new Set(), 'all')).toBe(0)
  })

  it('updates the list from the results instead of scanning again', () => {
    const targets = [target('a', 500, 100, 1), target('b', 900, 300, 1)]
    const afterAll = applyCleanResults(targets, [{ target: targets[0].target, freedBytes: 500, error: null }], 'all')
    expect(afterAll.map((t) => t.name)).toEqual(['b'])
    const afterCache = applyCleanResults(targets, [{ target: targets[1].target, freedBytes: 300, error: null }], 'incremental')
    expect(afterCache[1]).toMatchObject({ bytes: 600, incrementalBytes: 0 })
    // A folder partly kept (a running program locks its files) stays listed.
    const partly = applyCleanResults(targets, [{ target: targets[0].target, freedBytes: 200, error: 'in use' }], 'all')
    expect(partly[0]).toMatchObject({ bytes: 300 })
  })
})

describe('worktree suggestions', () => {
  it('keeps work that removing would lose', () => {
    expect(suggest(worktree({ changes: 3, merged: true }), NOW)).toEqual({ verdict: 'keep', reasons: ['3 uncommitted changes'] })
    expect(suggest(worktree({ ahead: 2 }), NOW).reasons).toEqual(['2 commits not pushed'])
    expect(suggest(worktree({ locked: true }), NOW).verdict).toBe('keep')
    expect(suggest(worktree({ upstream: null }), NOW)).toEqual({ verdict: 'keep', reasons: ['Commits only in this worktree'] })
  })

  it('offers merged worktrees and missing folders for removal', () => {
    expect(suggest(worktree({ merged: true }), NOW)).toEqual({ verdict: 'remove', reasons: ['Merged into master'] })
    expect(suggest(worktree({ missing: true, changes: null }), NOW)).toEqual({ verdict: 'remove', reasons: ['Folder is gone'] })
    expect(suggest(worktree({ merged: true, lastActiveMs: NOW - 45 * DAY }), NOW).reasons).toEqual(['Merged into master', 'Idle 45 days'])
  })

  /** A remote branch deleted after a squash merge leaves the commits off the main line: review, not remove. */
  it('asks for a review of a deleted remote branch or a long idle one', () => {
    expect(suggest(worktree({ upstreamGone: true }), NOW)).toEqual({
      verdict: 'review',
      reasons: ['Remote branch deleted', 'Not merged into master'],
    })
    expect(suggest(worktree({ lastActiveMs: NOW - 40 * DAY }), NOW)).toEqual({
      verdict: 'review',
      reasons: ['Idle 40 days', 'Everything pushed'],
    })
    expect(suggest(worktree({}), NOW)).toEqual({ verdict: 'keep', reasons: ['Used 1d ago'] })
    expect(suggest(worktree({ lastActiveMs: 0 }), NOW).reasons).toEqual(['In use'])
  })

  it('sorts by repository, then suggested removals first, then size', () => {
    const sorted = sortWorktrees(
      [
        worktree({ path: 'b-keep', repoName: 'b' }),
        worktree({ path: 'a-keep', repoName: 'a', bytes: 9000 }),
        worktree({ path: 'a-merged', repoName: 'a', merged: true, bytes: 10 }),
      ],
      NOW,
    )
    expect(sorted.map((w) => w.path)).toEqual(['a-merged', 'a-keep', 'b-keep'])
  })

  it('validates entries and reports from the backend', () => {
    const raw = worktree({})
    expect(parseWorktreeEntry(raw)).toEqual(raw)
    expect(parseWorktreeEntry({ ...raw, path: '' })).toBeNull()
    expect(parseWorktreeEntry({ path: 'p', repo: 'r' })).toMatchObject({ repoName: 'r', changes: null, bytes: null, merged: false })
    expect(parseRemoveReport({ removed: ['a', 3], failed: [{ path: 'b', reason: 'dirty' }, {}] })).toEqual({
      removed: ['a'],
      deletedBranches: [],
      keptBranches: [],
      failed: [{ path: 'b', reason: 'dirty' }],
    })
  })
})

describe('the added search folders', () => {
  it('reads only a stored list of folder names', () => {
    expect(readStoredRoots(null)).toEqual([])
    expect(readStoredRoots('not json')).toEqual([])
    expect(readStoredRoots('{"a":1}')).toEqual([])
    expect(readStoredRoots('["D:/code", 4, ""]')).toEqual(['D:/code'])
  })
})
