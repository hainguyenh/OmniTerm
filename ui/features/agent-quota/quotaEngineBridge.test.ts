import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchUsageRequest, QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'

import { BRIDGE_POLL_MS } from './bridgeFollower'
import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { getQuotaState, resetQuotaStore, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 10, 19, 3, 0)
const KEY = 'claude:c:\\p\\work'

const agent = (overrides: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: 's1', agent: 'claude', pid: 10, startTime: T0 / 1000, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null, ...overrides,
})

const snapshot = (usedPct: number, fetchedAt: number, source: QuotaSnapshot['source']): QuotaSnapshot => ({
  windows: [{ kind: 'session', label: '5-hour limit', usedPct }, { kind: 'weekly', label: 'Weekly limit', usedPct: 40 }],
  fetchedAt,
  source,
})

function setup(rows: SessionAgent[] = [agent()]) {
  let now = T0
  let bridge: QuotaSnapshot | null = null
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => rows),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async (): Promise<QuotaSnapshot> => snapshot(10, now, 'cli')),
    readBridge: vi.fn(async (_request: FetchUsageRequest) => bridge),
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const engine = new QuotaEngine({ api, now: () => now, random: () => 0, setTimer: () => 0, clearTimer: vi.fn() })
  updateQuota((state) => ({ ...state, config: DEFAULT_QUOTA_CONFIG }))
  engine.setInputs({ sessionIds: rows.map((row) => row.sessionId), busy: {} })
  const run = async (at: number) => {
    now = at
    await engine.tick()
    await engine.settle()
  }
  return { api, run, report: (reading: QuotaSnapshot | null) => { bridge = reading } }
}

const profile = () => getQuotaState().profiles[KEY]

beforeEach(() => resetQuotaStore())

describe('QuotaEngine following the status line bridge', () => {
  it('shows a new bridge record within seconds, without waiting for the next background read', async () => {
    const { api, run, report } = setup()
    await run(T0)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(10)
    const fetches = api.fetchUsage.mock.calls.length

    report(snapshot(55, T0 + 1_000, 'statusline'))
    await run(T0 + 1_000 + BRIDGE_POLL_MS)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(55)
    expect(profile()?.bridgeAt).toBe(T0 + 1_000)
    expect(api.fetchUsage.mock.calls.length).toBe(fetches)
    expect(api.readBridge).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', profileDir: 'C:\\p\\work' }))
  })

  it('applies each record once and looks at most every poll interval', async () => {
    const { api, run, report } = setup()
    report(snapshot(20, T0 - 500, 'statusline'))
    await run(T0)
    const looks = api.readBridge.mock.calls.length
    const samples = profile()?.history.length ?? 0
    await run(T0 + BRIDGE_POLL_MS / 2)
    expect(api.readBridge.mock.calls.length).toBe(looks)
    await run(T0 + BRIDGE_POLL_MS)
    expect(api.readBridge.mock.calls.length).toBe(looks + 1)
    expect(profile()?.history.length).toBe(samples)
  })

  it('keeps the bridge reading over a CLI read that lands after it', async () => {
    const { api, run, report } = setup()
    await run(T0)
    report(snapshot(60, T0 + 1_000, 'statusline'))
    await run(T0 + BRIDGE_POLL_MS)
    // A CLI read finishing later carries a later time, yet the agent's own report stands.
    api.fetchUsage.mockResolvedValueOnce(snapshot(12, T0 + 9_000, 'cli'))
    updateQuota((state) => ({ ...state, profiles: { ...state.profiles, [KEY]: { ...state.profiles[KEY], nextFetchAt: 0 } } }))
    await run(T0 + 9_000)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(60)
  })

  it('lets the CLI read take over once the bridge has gone quiet', async () => {
    const { api, run, report } = setup()
    report(snapshot(60, T0, 'statusline'))
    await run(T0)
    report(null)
    const later = T0 + 11 * 60_000
    api.fetchUsage.mockResolvedValueOnce(snapshot(70, later, 'cli'))
    updateQuota((state) => ({ ...state, profiles: { ...state.profiles, [KEY]: { ...state.profiles[KEY], nextFetchAt: 0 } } }))
    await run(later)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(70)
  })

  it('takes the bridge record from a background read once, and not again on the next read', async () => {
    const { api, run } = setup()
    api.fetchUsage.mockResolvedValue(snapshot(30, T0 - 60 * 60_000, 'statusline'))
    await run(T0)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(30)
    expect(profile()?.bridgeAt).toBe(T0 - 60 * 60_000)
    const samples = profile()?.history.length ?? 0
    updateQuota((state) => ({ ...state, profiles: { ...state.profiles, [KEY]: { ...state.profiles[KEY], nextFetchAt: 0 } } }))
    await run(T0 + 5_000)
    expect(api.fetchUsage.mock.calls.length).toBe(2)
    expect(profile()?.history.length).toBe(samples)
  })

  it('takes the same record again once one of its windows rolled over', async () => {
    const { run, report } = setup()
    report(snapshot(45, T0 - 500, 'statusline'))
    await run(T0)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(45)
    // Rust reads the 5-hour window that reset since as a new, unused one.
    report(snapshot(0, T0 - 500, 'statusline'))
    await run(T0 + BRIDGE_POLL_MS)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(0)
  })

  it('never rolls a newer CLI reading back to the same old record', async () => {
    const { api, run, report } = setup()
    report(snapshot(45, T0 - 500, 'statusline'))
    await run(T0)
    report(snapshot(0, T0 - 500, 'statusline'))
    const later = T0 + 11 * 60_000
    api.fetchUsage.mockResolvedValueOnce(snapshot(70, later, 'cli'))
    updateQuota((state) => ({ ...state, profiles: { ...state.profiles, [KEY]: { ...state.profiles[KEY], nextFetchAt: 0 } } }))
    await run(later)
    await run(later + BRIDGE_POLL_MS)
    expect(profile()?.lastGood?.windows[0].usedPct).toBe(70)
  })

  it('never looks for a bridge of a Codex profile', async () => {
    const { api, run } = setup([agent({ agent: 'codex', profileDir: 'C:\\c', profileName: 'codex' })])
    await run(T0)
    expect(api.readBridge).not.toHaveBeenCalled()
  })
})
