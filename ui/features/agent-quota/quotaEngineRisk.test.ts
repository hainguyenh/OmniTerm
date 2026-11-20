import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchUsageRequest, QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'
import type { ProfileCensus } from './profileCensus'

import { DANGER_RECORD_MS, IDLE_RECHECK_MS } from './profileCensus'
import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { FRESH_MS } from './quotaPolicy'
import { getQuotaState, resetQuotaStore, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 10, 19, 3, 0)
const DIR = 'C:\\p\\work'
const KEY = 'claude:c:\\p\\work'

const agent: SessionAgent = {
  sessionId: 's1', agent: 'claude', pid: 10, startTime: T0 / 1000, profileDir: DIR, profileName: 'work',
  subAgentCount: 0, launcher: null,
}

function setup(sessions: number, headless = 0) {
  let now = T0
  let busy = false
  const census = vi.fn(async (): Promise<ProfileCensus[]> => [{ profileDir: 'c:/p/work', sessions, headless }])
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => [agent]),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async (_request: FetchUsageRequest): Promise<QuotaSnapshot> => ({
      windows: [{ kind: 'session', label: '5-hour limit', usedPct: 20 }], fetchedAt: now, source: 'statusline',
    })),
    census,
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const engine = new QuotaEngine({ api, now: () => now, random: () => 0, setTimer: () => 0, clearTimer: vi.fn() })
  updateQuota((state) => ({ ...state, config: DEFAULT_QUOTA_CONFIG }))
  const run = async (at: number) => {
    now = at
    engine.setInputs({ sessionIds: ['s1'], busy: { s1: busy } })
    await engine.tick()
    await engine.settle()
  }
  const readNow = () => updateQuota((state) => ({ ...state, profiles: { ...state.profiles, [KEY]: { ...state.profiles[KEY], nextFetchAt: 0 } } }))
  return { api, run, readNow, setBusy: (value: boolean) => { busy = value } }
}

const profile = () => getQuotaState().profiles[KEY]

beforeEach(() => resetQuotaStore())

describe('QuotaEngine reading by how many sessions spend the profile', () => {
  it('reads nothing more for the one idle session of a profile that has a reading', async () => {
    const { api, run, readNow } = setup(1)
    await run(T0)
    readNow()
    const reads = api.fetchUsage.mock.calls.length
    await run(T0 + 1_000)
    expect(api.fetchUsage.mock.calls.length).toBe(reads)
    expect(profile()?.risk).toBe('idle')
    expect(profile()?.nextFetchAt).toBe(T0 + 1_000 + IDLE_RECHECK_MS)
  })

  it('takes the census when an agent starts, not on every tick', async () => {
    const { api, run } = setup(1)
    await run(T0)
    expect(api.census).toHaveBeenCalledTimes(1)
    for (let at = T0 + 1_000; at <= T0 + 60_000; at += 5_000) await run(at)
    expect(api.census).toHaveBeenCalledTimes(1)
  })

  it('reads the one session while it works, taking a record up to the fresh age', async () => {
    const { api, run, readNow, setBusy } = setup(1)
    await run(T0)
    setBusy(true)
    readNow()
    await run(T0 + 1_000)
    expect(api.fetchUsage).toHaveBeenLastCalledWith(expect.objectContaining({ agent: 'claude', profileDir: DIR, maxRecordAgeMs: FRESH_MS }))
    expect(profile()?.risk).toBe('active')
  })

  it('keeps reading an idle pane closely while other sessions or a headless run spend the profile', async () => {
    for (const [sessions, headless] of [[3, 0], [1, 1]]) {
      resetQuotaStore()
      const { api, run, readNow } = setup(sessions, headless)
      await run(T0)
      readNow()
      await run(T0 + 1_000)
      expect(api.fetchUsage).toHaveBeenLastCalledWith(expect.objectContaining({ maxRecordAgeMs: DANGER_RECORD_MS }))
      expect(profile()).toMatchObject({ risk: 'danger', activity: { sessions, headless } })
    }
  })
})
