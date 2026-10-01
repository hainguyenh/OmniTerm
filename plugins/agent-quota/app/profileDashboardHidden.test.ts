import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { DashboardRow } from './profileDashboard'

import { probeProfilesHidden } from './hiddenProfileProbe'
import { fetchAllMissingProfiles, fetchInactiveProfile, getProfileDashboard, resetProfileDashboard } from './profileDashboard'

vi.mock('./hiddenProfileProbe', () => ({
  probeProfilesHidden: vi.fn(),
  liveHiddenProbeDeps: vi.fn(() => ({})),
}))

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const ok = (usedPct: number): QuotaSnapshot => ({ windows: [{ kind: 'session', label: 's', usedPct }], fetchedAt: T0, source: 'cli' })
const failed = (message: string): QuotaSnapshot => ({ windows: [], fetchedAt: T0, error: 'failed', message })

const row = (name: string): DashboardRow => ({
  key: `claude:launcher:${name}`, agent: 'claude', profileName: name, profileDir: null, launcher: name,
  fetching: false, activeTerminalCount: 0,
})

function api(fetchUsage: AgentQuotaAPI['fetchUsage'], probeDir = true): AgentQuotaAPI {
  return {
    info: vi.fn(), detect: vi.fn(), suspend: vi.fn(), resume: vi.fn(), resumeAll: vi.fn(), terminate: vi.fn(), wake: vi.fn(),
    fetchUsage,
    ...(probeDir ? { probeDir: vi.fn(async () => 'C:\\Temp\\omniterm-wake') } : {}),
  }
}

const manual = (name: string) => getProfileDashboard().manualReadings[`claude:launcher:${name}`]

beforeEach(() => {
  resetProfileDashboard()
  vi.mocked(probeProfilesHidden).mockReset()
})

describe('profile dashboard reads through the hidden terminal', () => {
  it('shows hidden readings, and falls back to the background read only for what it could not read', async () => {
    vi.mocked(probeProfilesHidden).mockImplementation(async (targets, _deps, onResult) => {
      onResult(targets[0].key, ok(25))
      onResult(targets[1].key, failed('claude-b did not show its usage panel in time.'))
      return [targets[2].key]
    })
    const fetchUsage = vi.fn(async (request: { launcher?: string | null }) =>
      request.launcher === 'claude-b' ? failed('Quota service timed out.') : ok(60))
    await fetchAllMissingProfiles([row('claude-a'), row('claude-b'), row('claude-c')], api(fetchUsage))

    expect(fetchUsage.mock.calls.map(([request]) => request.launcher)).toEqual(['claude-b', 'claude-c'])
    expect(manual('claude-a')).toMatchObject({ reading: ok(25), fetching: false })
    // Both reads failed: the hidden run's reason is the useful one.
    expect(manual('claude-b')).toMatchObject({ error: 'claude-b did not show its usage panel in time.', fetching: false })
    expect(manual('claude-c')).toMatchObject({ reading: ok(60), fetching: false })
  })

  it('runs one hidden terminal at a time, and uses only the background read without a scratch folder', async () => {
    let finishFirst: () => void = () => {}
    const order: string[] = []
    vi.mocked(probeProfilesHidden).mockImplementation(async (targets, _deps, onResult) => {
      order.push(`start ${targets[0].key}`)
      if (order.length === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
      onResult(targets[0].key, ok(10))
      order.push(`end ${targets[0].key}`)
      return []
    })
    const both = api(vi.fn(async () => ok(1)))
    const first = fetchInactiveProfile(row('claude-a'), both)
    const second = fetchInactiveProfile(row('claude-b'), both)
    await Promise.resolve()
    expect(manual('claude-b')?.fetching).toBe(true)
    finishFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start claude:launcher:claude-a', 'end claude:launcher:claude-a', 'start claude:launcher:claude-b', 'end claude:launcher:claude-b'])

    const fetchUsage = vi.fn(async () => ok(33))
    vi.mocked(probeProfilesHidden).mockClear()
    await fetchInactiveProfile(row('claude-c'), api(fetchUsage, false))
    expect(probeProfilesHidden).not.toHaveBeenCalled()
    expect(manual('claude-c')).toMatchObject({ reading: ok(33) })
  })
})
