import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'
import type { TerminalAgent } from './quotaStore'

import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { getQuotaState, resetQuotaStore, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const KEY = 'claude:c:\\p\\work'

const agent = (overrides: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: 's1', agent: 'claude', pid: 10, startTime: T0 / 1000 - 3, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null, ...overrides,
})

const inlineReading: QuotaSnapshot = {
  windows: [{ kind: 'session', label: 'Current session', usedPct: 46 }],
  fetchedAt: T0,
  source: 'cli',
}

function setup(inlineProbe: (terminal: TerminalAgent) => Promise<QuotaSnapshot | null>) {
  let now = T0
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => [agent()]),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async (): Promise<QuotaSnapshot> => ({ windows: [{ kind: 'session', label: 's', usedPct: 10 }], fetchedAt: now })),
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const probe = vi.fn(inlineProbe)
  const engine = new QuotaEngine({
    api,
    now: () => now,
    random: () => 0,
    setTimer: () => 0,
    clearTimer: vi.fn(),
    inlineProbe: probe,
  })
  updateQuota((state) => ({ ...state, config: DEFAULT_QUOTA_CONFIG }))
  engine.setInputs({ sessionIds: ['s1'], busy: {} })
  const run = async (at = now) => {
    now = at
    await engine.tick()
    await engine.settle()
  }
  return { api, probe, run, engine }
}

beforeEach(() => resetQuotaStore())

describe('QuotaEngine inline quota read at launch and resume', () => {
  it('asks a freshly launched agent inline and skips the -p read when that works', async () => {
    const { api, probe, run } = setup(async () => inlineReading)
    await run()

    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', profileKey: KEY }))
    expect(api.fetchUsage).not.toHaveBeenCalled()
    const profile = getQuotaState().profiles[KEY]
    expect(profile.lastGood).toBe(inlineReading)
    expect(profile.fetching).toBe(false)
    expect(profile.nextFetchAt).toBeGreaterThan(T0)
  })

  it('falls back to the -p read when the inline probe gets nothing', async () => {
    const { api, run } = setup(async () => null)
    await run()
    expect(getQuotaState().profiles[KEY].nextFetchAt).toBe(0)

    await run(T0 + 1_000)
    expect(api.fetchUsage).toHaveBeenCalledTimes(1)
    expect(getQuotaState().profiles[KEY].lastGood?.windows[0].usedPct).toBe(10)
  })

  it('asks each agent instance once', async () => {
    const { probe, run } = setup(async () => inlineReading)
    await run()
    await run(T0 + 6_000)
    await run(T0 + 12_000)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('asks again when the agent is resumed on a profile that is already monitored (regression)', async () => {
    const resumed: QuotaSnapshot = { ...inlineReading, windows: [{ kind: 'session', label: 'Current session', usedPct: 52 }] }
    const { api, probe, run } = setup(async (terminal) => (terminal.pid === 10 ? inlineReading : resumed))
    await run()
    api.detect.mockResolvedValue([agent({ pid: 20, startTime: T0 / 1000 + 4 })])
    await run(T0 + 6_000)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({ pid: 20, profileKey: KEY }))
    expect(getQuotaState().profiles[KEY].lastGood).toBe(resumed)
    expect(api.fetchUsage).not.toHaveBeenCalled()
  })

  it('leaves the schedule of an existing profile alone when a resumed agent cannot be asked', async () => {
    const { api, run } = setup(async (terminal) => (terminal.pid === 10 ? inlineReading : null))
    await run()
    const scheduled = getQuotaState().profiles[KEY].nextFetchAt
    api.detect.mockResolvedValue([agent({ pid: 20, startTime: T0 / 1000 + 4 })])
    await run(T0 + 6_000)
    expect(getQuotaState().profiles[KEY].nextFetchAt).toBe(scheduled)
    expect(api.fetchUsage).not.toHaveBeenCalled()
  })

  it('holds the -p read while the probe runs', async () => {
    let finish: (snapshot: QuotaSnapshot | null) => void = () => {}
    const { api, engine } = setup(() => new Promise((resolve) => { finish = resolve }))
    // tick() starts the probe but does not wait for it, so the hold is observable mid-probe.
    await engine.tick()
    expect(getQuotaState().profiles[KEY].nextFetchAt).toBeGreaterThan(T0)
    await engine.tick()
    expect(api.fetchUsage).not.toHaveBeenCalled()
    finish(inlineReading)
    await engine.settle()
    expect(api.fetchUsage).not.toHaveBeenCalled()
    expect(getQuotaState().profiles[KEY].lastGood).toBe(inlineReading)
  })
})
