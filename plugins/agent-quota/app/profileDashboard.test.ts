import { beforeEach, describe, expect, it } from 'vitest'

import { dashboardRows, getProfileDashboard, resetProfileDashboard, setDashboardOpen } from './profileDashboard'
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
})
