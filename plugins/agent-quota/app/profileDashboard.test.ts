import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { QuotaSnapshot } from '../src/types'

import { dashboardRows, fetchAllMissingProfiles, getProfileDashboard, resetProfileDashboard, setDashboardOpen } from './profileDashboard'
import { getQuotaState, resetQuotaStore } from './quotaStore'
import { profile, reading, seed, terminal } from './__tests__/quotaFixtures'

beforeEach(() => {
  resetQuotaStore()
  resetProfileDashboard()
})

describe('profile dashboard store', () => {
  it('opens and closes', () => {
    setDashboardOpen(true)
    expect(getProfileDashboard().open).toBe(true)
    setDashboardOpen(false)
    expect(getProfileDashboard().open).toBe(false)
  })

  it('builds one row per active profile and counts shared terminals', () => {
    const work = terminal({
      sessionId: 'work-1',
      profileKey: 'claude:launcher:claude-work',
      profileName: 'claude-work',
      profileDir: null,
      launcher: 'claude-work',
      instanceKey: 'work-1:10:100',
    })
    const secondWork = { ...work, sessionId: 'work-2', instanceKey: 'work-2:11:101' }
    const side = terminal({
      sessionId: 'side',
      profileKey: 'claude:launcher:claude-side',
      profileName: 'claude-side',
      profileDir: null,
      launcher: 'claude-side',
      instanceKey: 'side:12:102',
    })
    const orphan = profile(reading(5), { key: 'claude:orphan', profileName: 'orphan' })
    seed({ terminals: [work, secondWork, side], profiles: [
      profile(reading(40), { key: work.profileKey, profileName: work.profileName, profileDir: null, launcher: work.launcher }),
      profile(reading(20), { key: side.profileKey, profileName: side.profileName, profileDir: null, launcher: side.launcher }),
      orphan,
    ] })

    const rows = dashboardRows(getQuotaState())
    expect(rows.map((row) => row.profileName)).toEqual(['claude-side', 'claude-work'])
    expect(rows.find((row) => row.key === work.profileKey)?.activeTerminalCount).toBe(2)
  })

  it('keeps the last good reading and exposes the latest engine error', () => {
    const current = profile(reading(40), {
      snapshot: { windows: [], fetchedAt: 2, error: 'timeout', message: 'Quota service timed out.' },
    })
    seed({ profiles: [current] })

    expect(dashboardRows(getQuotaState())[0]).toMatchObject({
      reading: reading(40),
      error: 'Quota service timed out.',
      activeTerminalCount: 1,
    })
  })

  it('includes discovered inactive profiles with 0 active terminals', () => {
    const discovered = [
      { agent: 'claude' as const, profileName: 'claude-inactive', profileDir: null, launcher: 'claude-inactive' },
    ]
    const rows = dashboardRows({ profiles: {}, terminals: {} }, discovered)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      profileName: 'claude-inactive',
      activeTerminalCount: 0,
      reading: undefined,
    })
  })

  it('fetches only inactive profiles without readings in fetchAllMissingProfiles', async () => {
    const discovered = [
      { agent: 'claude' as const, profileName: 'claude-first', profileDir: null, launcher: 'claude-first' },
      { agent: 'claude' as const, profileName: 'claude-second', profileDir: null, launcher: 'claude-second' },
    ]
    const readingNow: QuotaSnapshot = {
      windows: [{ kind: 'session', label: 'Session', usedPct: 10, resetsAt: Date.now() + 3600_000 }],
      fetchedAt: Date.now(),
      source: 'cli',
    }
    const fetchUsage = vi.fn().mockImplementation(async (req) => {
      if (req.launcher === 'claude-first') return readingNow
      return { windows: [], fetchedAt: Date.now(), error: 'failed', message: 'Read error' }
    })
    const mockApi: AgentQuotaAPI = {
      info: vi.fn(),
      detect: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
      resumeAll: vi.fn(),
      terminate: vi.fn(),
      fetchUsage,
      listProfiles: vi.fn(),
      wake: vi.fn(),
    }

    // claude-first already has a reading; claude-second does not
    const rows = dashboardRows(
      { profiles: {}, terminals: {} },
      discovered,
      { 'claude:launcher:claude-first': { reading: readingNow } },
    )
    expect(rows).toHaveLength(2)

    await fetchAllMissingProfiles(rows, mockApi)

    // claude-first should NOT have been fetched; only claude-second
    expect(fetchUsage).toHaveBeenCalledTimes(1)
    expect(fetchUsage).toHaveBeenCalledWith({ agent: 'claude', profileDir: null, launcher: 'claude-second' })

    const manual = getProfileDashboard().manualReadings
    expect(manual['claude:launcher:claude-second']?.error).toBe('Read error')
    expect(manual['claude:launcher:claude-second']?.fetching).toBe(false)
  })
})
