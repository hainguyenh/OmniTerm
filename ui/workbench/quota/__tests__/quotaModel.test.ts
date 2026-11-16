import { describe, expect, it } from 'vitest'

import { NOW, profile, reading } from '../../../features/agent-quota/__tests__/quotaFixtures'
import { nearestReset, quotaGroups } from '../quotaModel'

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
