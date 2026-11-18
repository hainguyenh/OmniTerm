import { describe, expect, it } from 'vitest'

import { NOW, profile, reading, terminal } from '../../../features/agent-quota/__tests__/quotaFixtures'
import { footerProfiles, nearestReset, quotaGroups } from '../quotaModel'

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

  it('lists the running profiles, the one nearest its 5h limit first', () => {
    const rows = footerProfiles({ terminals, profiles, now: NOW }, null)
    // `idle` has no running agent; the two `work` profiles carry their agent's tag.
    expect(rows.map((row) => [row.label, row.pct])).toEqual([
      ['home', 91],
      ['work (Cl)', 40],
      ['work (Cx)', 10],
    ])
    expect(rows[0]?.detail).toMatch(/^Claude · 5h window · resets/)
  })

  it('marks the profile of the active session and puts one without a reading last', () => {
    const fresh = profile(undefined, { key: 'claude:new', profileName: 'new' })
    const rows = footerProfiles(
      { terminals: { ...terminals, s4: terminal({ sessionId: 's4', profileKey: fresh.key }) }, profiles: { ...profiles, [fresh.key]: fresh }, now: NOW },
      { sessionId: 's1', agent: 'claude', profileKey: work.key, profileName: 'work' },
    )
    expect(rows.at(-1)).toMatchObject({ label: 'new', pct: null })
    expect(rows.filter((row) => row.active).map((row) => row.key)).toEqual([work.key])
  })

  it('shows every known profile while no agent runs', () => {
    expect(footerProfiles({ terminals: {}, profiles, now: NOW }, null).map((row) => row.key)[0]).toBe(idle.key)
    expect(footerProfiles({ terminals: {}, profiles, now: NOW }, null)).toHaveLength(4)
  })
})
