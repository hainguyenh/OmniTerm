import { describe, expect, it } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { AdvisorProfile } from './profileAdvisor'

import { adviseProfiles } from './profileAdvisor'

const NOW = Date.UTC(2026, 8, 25, 3, 0)
const HOUR = 3_600_000
const DAY = 24 * HOUR
const LIMITS = { session: 90, weekly: 95 }

function reading(session: number, weekly: number, { sessionResetIn = 2 * HOUR, weeklyResetIn = 5 * DAY } = {}): QuotaSnapshot {
  return {
    windows: [
      { kind: 'session', label: 'Current session', usedPct: session, resetsAt: NOW + sessionResetIn },
      { kind: 'weekly', label: 'Current week', usedPct: weekly, resetsAt: NOW + weeklyResetIn },
    ],
    fetchedAt: NOW,
  }
}

const profile = (name: string, snapshot?: QuotaSnapshot): AdvisorProfile => ({ key: `claude:launcher:${name}`, name, reading: snapshot })

describe('adviseProfiles', () => {
  it('recommends the most 5h room when nothing is about to expire', () => {
    const result = adviseProfiles([
      profile('claude-a', reading(60, 30)),
      profile('claude-b', reading(20, 30)),
    ], LIMITS, NOW)
    expect(result.best).toMatchObject({ name: 'claude-b', status: 'best', sessionLeft: 70, weeklyLeft: 65, reason: '70% of 5h left · 65% of weekly left' })
    expect(result.alternative).toMatchObject({ name: 'claude-a', status: 'ok' })
    expect(result.nextAvailable).toBeNull()
  })

  it('prefers weekly quota that resets soon — use it or lose it', () => {
    const result = adviseProfiles([
      profile('claude-fresh', reading(20, 30)),
      profile('claude-expiring', reading(40, 60, { weeklyResetIn: 12 * HOUR })),
    ], LIMITS, NOW)
    expect(result.best?.name).toBe('claude-expiring')
    expect(result.best?.reason).toBe('50% of 5h left · weekly resets in 12h 00m — spend it before it expires')
  })

  it('does not chase expiring weekly quota the 5h window cannot spend', () => {
    const result = adviseProfiles([
      profile('claude-fresh', reading(20, 30)),
      profile('claude-tight', reading(85, 40, { weeklyResetIn: 6 * HOUR })),
    ], LIMITS, NOW)
    expect(result.best?.name).toBe('claude-fresh')
  })

  it('halves a profile that has almost no weekly quota left', () => {
    const result = adviseProfiles([
      profile('claude-empty-week', reading(0, 90)),
      profile('claude-half', reading(45, 20)),
    ], LIMITS, NOW)
    expect(result.best?.name).toBe('claude-half')
    expect(result.alternative?.reason).toBe('90% of 5h left · only 5% of weekly left')
  })

  it('marks profiles at a limit as limited, ranked by when they free up', () => {
    const result = adviseProfiles([
      profile('claude-week', reading(10, 95, { weeklyResetIn: 3 * DAY })),
      profile('claude-session', reading(92, 50, { sessionResetIn: 80 * 60_000 })),
      profile('claude-both', { windows: [
        { kind: 'session', label: 's', usedPct: 90, resetsAt: NOW + HOUR },
        { kind: 'weekly', label: 'w', usedPct: 99 },
      ], fetchedAt: NOW }),
    ], LIMITS, NOW)
    expect(result.best).toBeNull()
    expect(result.alternative).toBeNull()
    expect(result.ranked.map((advice) => [advice.name, advice.status, advice.reason])).toEqual([
      ['claude-session', 'limited', '5h limit reached — available in 1h 20m'],
      ['claude-week', 'limited', 'Weekly limit reached — available in 3d 0h'],
      ['claude-both', 'limited', 'Weekly and 5h limit reached'],
    ])
    expect(result.nextAvailable?.name).toBe('claude-session')
  })

  it('counts a window whose reset has passed as empty', () => {
    const stale = reading(95, 40, { sessionResetIn: -10 * 60_000 })
    const result = adviseProfiles([profile('claude-reset', stale)], LIMITS, NOW)
    expect(result.best).toMatchObject({ name: 'claude-reset', sessionLeft: 90 })
  })

  it('lists profiles without a reading last and never recommends them', () => {
    const result = adviseProfiles([
      profile('claude-z'),
      profile('claude-a', { windows: [], fetchedAt: NOW }),
      profile('claude-ok', reading(50, 50)),
    ], LIMITS, NOW)
    expect(result.ranked.map((advice) => [advice.name, advice.status])).toEqual([
      ['claude-ok', 'best'],
      ['claude-a', 'noData'],
      ['claude-z', 'noData'],
    ])
    expect(result.ranked[1].reason).toBe('No reading yet — fetch to compare it')
    expect(adviseProfiles([profile('claude-z')], LIMITS, NOW)).toMatchObject({ best: null, nextAvailable: null })
  })

  it('copes with readings missing a window', () => {
    const weeklyOnly = adviseProfiles([profile('codex-w', { windows: [{ kind: 'weekly', label: 'w', usedPct: 10 }], fetchedAt: NOW })], LIMITS, NOW)
    expect(weeklyOnly.best?.reason).toBe('5h unknown · 85% of weekly left')
    const sessionOnly = adviseProfiles([profile('codex-s', { windows: [{ kind: 'session', label: 's', usedPct: 10 }], fetchedAt: NOW })], LIMITS, NOW)
    expect(sessionOnly.best?.reason).toBe('80% of 5h left')
  })

  it('breaks score ties by name', () => {
    const result = adviseProfiles([profile('claude-b', reading(10, 10)), profile('claude-a', reading(10, 10))], LIMITS, NOW)
    expect(result.ranked.map((advice) => advice.name)).toEqual(['claude-a', 'claude-b'])
  })
})
