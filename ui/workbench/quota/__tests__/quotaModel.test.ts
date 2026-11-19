import { describe, expect, it } from 'vitest'

import { NOW, profile, reading, terminal } from '../../../features/agent-quota/__tests__/quotaFixtures'
import { footerAgents, footerProfiles, nearestReset, quotaGroups } from '../quotaModel'

describe('nearestReset', () => {
  it('is the soonest shown window reset still ahead', () => {
    const work = profile(reading(40))
    const later = profile(
      { ...reading(10), windows: [{ kind: 'session', label: 's', usedPct: 10, resetsAt: NOW + 7_200_000 }] },
      { key: 'claude:other', profileName: 'other' },
    )
    expect(nearestReset({ [work.key]: work, [later.key]: later }, NOW)).toBe(NOW + 3_600_000)
    // Past resets and profiles without a reading are skipped.
    expect(nearestReset({ [work.key]: work }, NOW + 3_600_000)).toBeUndefined()
    const empty = profile(undefined)
    expect(nearestReset({ [empty.key]: empty }, NOW)).toBeUndefined()
  })

  it('matches what the rows show', () => {
    const work = profile(reading(40))
    const [group] = quotaGroups({ profiles: { [work.key]: work }, now: NOW }, null)
    expect(group.shown.detail).toContain('resets')
    expect(group.shown.pct).toBe(40)
  })
})

describe('footerAgents', () => {
  const work = profile(reading(40))
  const home = profile(reading(91), { key: 'claude:home', profileName: 'home' })
  const idle = profile(reading(99), { key: 'claude:idle', profileName: 'idle' })
  const codex = profile(reading(10), { key: 'codex:work', agent: 'codex', profileName: 'work' })
  const profiles = Object.fromEntries([work, home, idle, codex].map((p) => [p.key, p]))

  it('counts the running profiles of each agent, not the known ones', () => {
    const terminals = {
      s1: terminal({ sessionId: 's1', profileKey: work.key }),
      // A second terminal on the same profile is still one active profile.
      s2: terminal({ sessionId: 's2', profileKey: work.key }),
    }
    const rows = footerAgents({ terminals, profiles }, null)
    expect(rows.map((row) => [row.name, row.activeProfiles])).toEqual([['Claude', 1]])
  })

  it('lists every agent that runs and marks the agent of the active session', () => {
    const terminals = {
      s1: terminal({ sessionId: 's1', profileKey: work.key }),
      s2: terminal({ sessionId: 's2', profileKey: home.key, profileName: 'home' }),
      s3: terminal({ sessionId: 's3', agent: 'codex', profileKey: codex.key }),
    }
    const rows = footerAgents({ terminals, profiles }, { sessionId: 's3', agent: 'codex', profileKey: codex.key, profileName: 'work' })
    expect(rows.map((row) => [row.name, row.activeProfiles, row.active])).toEqual([
      ['Claude', 2, false],
      ['Codex', 1, true],
    ])
  })

  it('shows each known agent with no active profile while nothing runs', () => {
    const rows = footerAgents({ terminals: {}, profiles }, null)
    expect(rows.map((row) => [row.name, row.activeProfiles])).toEqual([['Claude', 0], ['Codex', 0]])
  })
})

describe('footerProfiles', () => {
  const work = profile(reading(40))
  const home = profile(reading(91), { key: 'claude:home', profileName: 'home' })
  const idle = profile(reading(99), { key: 'claude:idle', profileName: 'idle' })
  const codex = profile(reading(10), { key: 'codex:work', agent: 'codex', profileName: 'work' })
  const profiles = Object.fromEntries([work, home, idle, codex].map((p) => [p.key, p]))
  const terminals = {
    s1: terminal({ sessionId: 's1', profileKey: work.key }),
    s2: terminal({ sessionId: 's2', profileKey: home.key, profileName: 'home' }),
    s3: terminal({ sessionId: 's3', agent: 'codex', profileKey: codex.key }),
  }

  it('lists only running profiles, the one nearest its 5h limit first', () => {
    const rows = footerProfiles({ terminals, profiles, now: NOW }, null)
    expect(rows.map((row) => [row.label, row.pct])).toEqual([['home', 91], ['work (Cl)', 40], ['work (Cx)', 10]])
    expect(rows[0]?.detail).toMatch(/^Claude · 5h window · resets/)
  })

  it('marks the profile of the active session', () => {
    const rows = footerProfiles({ terminals, profiles, now: NOW }, { sessionId: 's1', agent: 'claude', profileKey: work.key, profileName: 'work' })
    expect(rows.filter((row) => row.active).map((row) => row.key)).toEqual([work.key])
  })

  it('lists nothing while no agent runs, instead of every known profile', () => {
    expect(footerProfiles({ terminals: {}, profiles, now: NOW }, null)).toEqual([])
  })
})
