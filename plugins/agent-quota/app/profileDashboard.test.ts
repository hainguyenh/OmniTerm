import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveredProfile, FetchUsageRequest, QuotaSnapshot } from '../src/types'
import type { DashboardDeps, DashboardRow } from './profileDashboard'

import {
  dashboardKey,
  fetchDashboardProfiles,
  formatAgo,
  freshestReading,
  getProfileDashboard,
  loadDashboardProfiles,
  resetProfileDashboard,
  setDashboardOpen,
} from './profileDashboard'
import { profileKeyOf } from './quotaEngine'
import { profile } from './__tests__/quotaFixtures'

const WORK: DiscoveredProfile = { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' }
const DEFAULT: DiscoveredProfile = { agent: 'claude', profileName: 'claude', profileDir: 'C:\\Users\\me\\.claude', launcher: null }
const good = (usedPct: number, fetchedAt = 1): QuotaSnapshot => ({ windows: [{ kind: 'session', label: 's', usedPct }], fetchedAt })

function deps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return { listProfiles: vi.fn(async () => [DEFAULT, WORK]), fetchUsage: vi.fn(async () => good(10)), ...overrides }
}

beforeEach(() => resetProfileDashboard())

describe('profile dashboard store', () => {
  it('keys profiles exactly like the engine, so monitored readings line up', () => {
    const detected = { sessionId: 's', pid: 1, startTime: 1, subAgentCount: 0 }
    expect(dashboardKey(WORK)).toBe(profileKeyOf({ ...detected, ...WORK, launcher: 'claude-work' }))
    expect(dashboardKey({ ...WORK, launcher: 'claude-Work' })).toBe('claude:launcher:claude-work')
    expect(dashboardKey(DEFAULT)).toBe(profileKeyOf({ ...detected, ...DEFAULT }))
  })

  it('opens and closes', () => {
    setDashboardOpen(true)
    expect(getProfileDashboard().open).toBe(true)
    setDashboardOpen(true)
    setDashboardOpen(false)
    expect(getProfileDashboard().open).toBe(false)
  })

  it('lists discovered and monitored profiles once, keeping readings across reloads', async () => {
    const monitored = profile(good(40), { key: 'claude:d:\\custom', profileName: 'custom', profileDir: 'D:\\custom' })
    await loadDashboardProfiles(deps(), { [monitored.key]: monitored, [dashboardKey(WORK)]: profile(undefined, { key: dashboardKey(WORK), profileName: 'claude-work', launcher: 'claude-work', profileDir: null }) })
    expect(getProfileDashboard().rows.map((row) => row.key)).toEqual(['claude:c:\\users\\me\\.claude', 'claude:launcher:claude-work', 'claude:d:\\custom'])

    await fetchDashboardProfiles(deps(), ['claude:launcher:claude-work'])
    await loadDashboardProfiles(deps({ listProfiles: vi.fn(async () => { throw new Error('gone') }) }), {})
    expect(getProfileDashboard().rows).toEqual([])
    await loadDashboardProfiles(deps())
    await fetchDashboardProfiles(deps(), ['claude:launcher:claude-work'])
    await loadDashboardProfiles(deps())
    expect(getProfileDashboard().rows.find((row) => row.launcher === 'claude-work')?.reading).toEqual(good(10))
    expect(getProfileDashboard().listing).toBe(false)
  })

  it('lists Claude profiles only, even when the engine monitors a codex one', async () => {
    const codex: DiscoveredProfile = { agent: 'codex', profileName: 'codex-alt', profileDir: null, launcher: 'codex-alt' }
    const monitored = profile(good(40), { key: 'codex:launcher:codex', agent: 'codex', profileName: 'codex', launcher: 'codex', profileDir: null })
    await loadDashboardProfiles(deps({ listProfiles: vi.fn(async () => [DEFAULT, codex]) }), { [monitored.key]: monitored })
    expect(getProfileDashboard().rows.map((row) => row.agent)).toEqual(['claude'])
  })

  it('fetches every profile two at a time, a launcher without a directory of its own', async () => {
    let running = 0
    let peak = 0
    const requests: FetchUsageRequest[] = []
    const fetchUsage = vi.fn(async (request: FetchUsageRequest) => {
      requests.push(request)
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return good(20)
    })
    const many = Array.from({ length: 5 }, (_, index): DiscoveredProfile => ({ ...WORK, profileName: `claude-p${index}`, launcher: `claude-p${index}` }))
    const withDir: DiscoveredProfile = { ...WORK, profileDir: 'X:\\ignored' }
    const live = deps({ listProfiles: vi.fn(async () => [DEFAULT, withDir, ...many]), fetchUsage })
    await loadDashboardProfiles(live)
    const pending = fetchDashboardProfiles(live)
    expect(getProfileDashboard().fetchingAll).toBe(true)
    await pending
    expect(peak).toBe(2)
    expect(fetchUsage).toHaveBeenCalledTimes(7)
    expect(requests[0]).toEqual({ agent: 'claude', profileDir: 'C:\\Users\\me\\.claude', launcher: null })
    expect(requests[1]).toEqual({ agent: 'claude', profileDir: null, launcher: 'claude-work' })
    expect(getProfileDashboard()).toMatchObject({ fetchingAll: false })
    expect(getProfileDashboard().rows.every((row) => !row.fetching && row.reading)).toBe(true)
  })

  it('keeps the last good reading and records why a fetch failed', async () => {
    const fetchUsage = vi.fn(async (): Promise<QuotaSnapshot> => good(30))
    const live = deps({ listProfiles: vi.fn(async () => [WORK]), fetchUsage })
    await loadDashboardProfiles(live)
    await fetchDashboardProfiles(live)
    fetchUsage.mockResolvedValueOnce({ windows: [], fetchedAt: 2, error: 'timeout', message: 'claude /usage timed out.' })
    await fetchDashboardProfiles(live)
    expect(getProfileDashboard().rows[0]).toMatchObject({ reading: good(30), error: 'claude /usage timed out.' })
    fetchUsage.mockRejectedValueOnce(new Error('ipc down'))
    await fetchDashboardProfiles(live)
    expect(getProfileDashboard().rows[0].error).toBe('Error: ipc down')
    fetchUsage.mockResolvedValueOnce({ windows: [], fetchedAt: 3 })
    await fetchDashboardProfiles(live)
    expect(getProfileDashboard().rows[0].error).toBe('The reading could not be taken.')
    await fetchDashboardProfiles(live)
    expect(getProfileDashboard().rows[0].error).toBeUndefined()
    await fetchDashboardProfiles(live, ['nope'])
    expect(fetchUsage).toHaveBeenCalledTimes(5)
  })

  it('shows the newer of its own and the engine reading', () => {
    const row: DashboardRow = { key: 'k', agent: 'claude', profileName: 'p', profileDir: null, launcher: null, fetching: false }
    expect(freshestReading(row, {})).toBeUndefined()
    const engine = { k: profile(good(50, 5), { key: 'k' }) }
    expect(freshestReading(row, engine)).toEqual(good(50, 5))
    expect(freshestReading({ ...row, reading: good(60, 9) }, engine)).toEqual(good(60, 9))
    expect(freshestReading({ ...row, reading: good(60, 2) }, engine)).toEqual(good(50, 5))
    expect(freshestReading({ ...row, reading: good(60, 2) }, {})).toEqual(good(60, 2))
  })

  it('formats how old a reading is', () => {
    expect(formatAgo(1_000, 20_000)).toBe('just now')
    expect(formatAgo(0, 12 * 60_000)).toBe('12m ago')
    expect(formatAgo(0, 3 * 3_600_000)).toBe('3h ago')
    expect(formatAgo(0, 50 * 3_600_000)).toBe('2d ago')
    expect(formatAgo(10, 0)).toBe('just now')
  })
})
