/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveredProfile, QuotaSnapshot } from '../../src/types'
import type { AgentQuotaAPI, SessionAgent } from '../agentQuotaAPI'
import type { TerminalAgent } from '../quotaStore'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { QuotaEngine } from '../quotaEngine'
import {
  dashboardRows,
  fetchInactiveProfile,
  getProfileDashboard,
  resetProfileDashboard,
  setDiscoveredProfiles,
} from '../profileDashboard'
import { getQuotaState, resetQuotaStore, updateQuota } from '../quotaStore'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const PROFILE_KEY_1 = 'claude:c:\\p\\work'
const PROFILE_KEY_2 = 'claude:c:\\p\\project-b'

const snapshot1: QuotaSnapshot = {
  windows: [
    { kind: 'session', label: 'Current session', usedPct: 30 },
    { kind: 'weekly', label: 'Current week', usedPct: 60 },
  ],
  fetchedAt: T0,
  source: 'cli',
}

const snapshot2: QuotaSnapshot = {
  windows: [
    { kind: 'session', label: 'Current session', usedPct: 15 },
    { kind: 'weekly', label: 'Current week', usedPct: 25 },
  ],
  fetchedAt: T0 + 10_000,
  source: 'cli',
}

describe('Profile lifecycle simulation: init -> active -> closed -> reopen', () => {
  beforeEach(() => {
    resetQuotaStore()
    resetProfileDashboard()
  })
  afterEach(() => {
    resetQuotaStore()
    resetProfileDashboard()
  })

  it('simulates full lifecycle: init empty -> fetch inactive -> activate profile -> close -> fetch inactive -> reopen new profile', async () => {
    let now = T0
    let detectedAgents: SessionAgent[] = []
    let openSessionIds: string[] = []

    const api: AgentQuotaAPI = {
      info: vi.fn(async () => true),
      detect: vi.fn(async () => detectedAgents),
      suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] })),
      resume: vi.fn(async () => 1),
      resumeAll: vi.fn(async () => 0),
      terminate: vi.fn(async () => 1),
      fetchUsage: vi.fn(async (req) => {
        if (req.profileDir?.includes('project-b')) return snapshot2
        return snapshot1
      }),
      wake: vi.fn(async () => ({ ok: true })),
      listProfiles: vi.fn(async (): Promise<DiscoveredProfile[]> => [
        { agent: 'claude', profileName: 'work', profileDir: 'C:\\p\\work', launcher: null },
        { agent: 'claude', profileName: 'project-b', profileDir: 'C:\\p\\project-b', launcher: null },
      ]),
    }

    const inlineProbe = vi.fn(async (terminal: TerminalAgent) => {
      if (terminal.profileKey === PROFILE_KEY_1) return snapshot1
      if (terminal.profileKey === PROFILE_KEY_2) return snapshot2
      return null
    })

    const engine = new QuotaEngine({
      api,
      now: () => now,
      random: () => 0,
      setTimer: () => 0,
      clearTimer: vi.fn(),
      inlineProbe,
    })

    updateQuota((state) => ({ ...state, config: DEFAULT_QUOTA_CONFIG }))
    const runTick = async (at = now) => {
      now = at
      engine.setInputs({ sessionIds: openSessionIds, busy: {} })
      await engine.tick()
      await engine.settle()
    }

    // 1. First time init with no active profiles or terminals
    await runTick()
    expect(Object.keys(getQuotaState().terminals)).toHaveLength(0)
    expect(Object.keys(getQuotaState().profiles)).toHaveLength(0)

    const discovered: DiscoveredProfile[] = await api.listProfiles!()
    setDiscoveredProfiles(discovered)

    let rows = dashboardRows(getQuotaState(), discovered)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.activeTerminalCount === 0)).toBe(true)
    const workRowBefore = rows.find((r) => r.key === PROFILE_KEY_1)!
    expect(workRowBefore.reading).toBeUndefined()

    // Fetch quota for inactive profile before any terminal opened
    await fetchInactiveProfile(workRowBefore, api)
    expect(api.fetchUsage).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', profileDir: 'C:\\p\\work' }))

    rows = dashboardRows(getQuotaState(), discovered, getProfileDashboard().manualReadings)
    const workRowUpdated = rows.find((r) => r.key === PROFILE_KEY_1)!
    expect(workRowUpdated.reading).toBeDefined()
    expect(workRowUpdated.reading?.windows[0].usedPct).toBe(30)
    expect(workRowUpdated.activeTerminalCount).toBe(0)

    // 2. An active terminal opens running the profile
    const terminal1: SessionAgent = {
      sessionId: 'term-1',
      agent: 'claude',
      pid: 101,
      startTime: now / 1000 - 2,
      profileDir: 'C:\\p\\work',
      profileName: 'work',
      subAgentCount: 0,
      launcher: null,
    }
    openSessionIds = ['term-1']
    detectedAgents = [terminal1]

    await runTick(now + 6_000)

    expect(inlineProbe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'term-1', profileKey: PROFILE_KEY_1 }))
    expect(getQuotaState().terminals['term-1']).toBeDefined()
    expect(getQuotaState().profiles[PROFILE_KEY_1].lastGood).toEqual(snapshot1)

    rows = dashboardRows(getQuotaState(), discovered, getProfileDashboard().manualReadings)
    const workRow = rows.find((r) => r.key === PROFILE_KEY_1)
    expect(workRow?.activeTerminalCount).toBe(1)
    expect(workRow?.reading).toEqual(snapshot1)

    // 3. Profile is no longer used, terminal closed, then we fetch
    openSessionIds = []
    detectedAgents = []

    await runTick(now + 6_000)

    expect(Object.keys(getQuotaState().terminals)).toHaveLength(0)
    expect(Object.keys(getQuotaState().profiles)).toHaveLength(0)

    rows = dashboardRows(getQuotaState(), discovered, getProfileDashboard().manualReadings)
    const closedWorkRow = rows.find((r) => r.key === PROFILE_KEY_1)
    expect(closedWorkRow?.activeTerminalCount).toBe(0)

    vi.mocked(api.fetchUsage).mockClear()
    await fetchInactiveProfile(closedWorkRow!, api)
    expect(api.fetchUsage).toHaveBeenCalledTimes(1)

    // 4. Reopen a new profile (project-b)
    const terminal2: SessionAgent = {
      sessionId: 'term-2',
      agent: 'claude',
      pid: 202,
      startTime: now / 1000 - 2,
      profileDir: 'C:\\p\\project-b',
      profileName: 'project-b',
      subAgentCount: 0,
      launcher: null,
    }
    openSessionIds = ['term-2']
    detectedAgents = [terminal2]

    await runTick(now + 8_000)

    expect(inlineProbe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'term-2', profileKey: PROFILE_KEY_2 }))
    expect(getQuotaState().terminals['term-2']).toBeDefined()
    expect(getQuotaState().profiles[PROFILE_KEY_2].lastGood).toEqual(snapshot2)

    rows = dashboardRows(getQuotaState(), discovered, getProfileDashboard().manualReadings)
    const projBRow = rows.find((r) => r.key === PROFILE_KEY_2)
    expect(projBRow?.activeTerminalCount).toBe(1)
    expect(projBRow?.reading).toEqual(snapshot2)
  })
})
