import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'

import { DEFAULT_QUOTA_CONFIG, type QuotaConfig } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { resetQuotaStore, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 8, 25, 3, 0)

const agent = (overrides: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: 's1', agent: 'claude', pid: 10, startTime: T0 / 1000, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null, ...overrides,
})

const reading: QuotaSnapshot = { windows: [{ kind: 'session', label: 's', usedPct: 30 }], fetchedAt: T0, source: 'cli' }

function setup(config: QuotaConfig = DEFAULT_QUOTA_CONFIG) {
  let now = T0
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async (): Promise<SessionAgent[]> => []),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async () => reading),
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const launchHold = { hold: vi.fn(), release: vi.fn() }
  const probe = vi.fn(async () => reading)
  const engine = new QuotaEngine({
    api,
    now: () => now,
    random: () => 0,
    setTimer: () => 0,
    clearTimer: vi.fn(),
    inlineProbe: probe,
    launchHold,
  })
  updateQuota((state) => ({ ...state, config }))
  engine.setInputs({ sessionIds: ['s1'], busy: {} })
  const run = async (at: number) => {
    now = at
    await engine.tick()
    await engine.settle()
  }
  return { api, engine, launchHold, probe, run }
}

beforeEach(() => resetQuotaStore())

describe('QuotaEngine launch hold', () => {
  it('freezes the pane at once and hands it to the probe as soon as the agent shows up', async () => {
    const { api, engine, launchHold, probe, run } = setup()
    await run(T0)
    engine.noteLaunch('s1', 'claude')
    expect(launchHold.hold).toHaveBeenCalledWith('s1')

    // Looked for on the next tick and every second after, not on the 5 s scan.
    await run(T0 + 1_000)
    await run(T0 + 2_000)
    expect(api.detect).toHaveBeenCalledTimes(3)
    api.detect.mockResolvedValue([agent()])
    await run(T0 + 3_000)

    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }))
    // The probe adopts the hold and lets go of it itself.
    expect(launchHold.release).not.toHaveBeenCalled()
    await run(T0 + 4_000)
    await run(T0 + 5_000)
    expect(api.detect).toHaveBeenCalledTimes(4)
  })

  it('lets go at once when the Enter went to an agent that was already running', async () => {
    const { api, engine, launchHold, probe, run } = setup()
    api.detect.mockResolvedValue([agent()])
    await run(T0)
    engine.noteLaunch('s1', 'claude')
    await run(T0 + 1_000)
    expect(launchHold.release).toHaveBeenCalledWith('s1')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('lets go when no agent shows up, or the shell is idle again', async () => {
    const { engine, launchHold, run } = setup()
    await run(T0)
    engine.noteLaunch('s1', 'claude')
    await run(T0 + 19_000)
    expect(launchHold.release).not.toHaveBeenCalled()
    await run(T0 + 20_000)
    expect(launchHold.release).toHaveBeenCalledWith('s1')

    engine.noteLaunch('s1', 'claude')
    engine.setInputs({ sessionIds: ['s1'], busy: { s1: false } })
    await run(T0 + 25_000)
    expect(launchHold.release).toHaveBeenCalledTimes(1)
    await run(T0 + 26_000)
    expect(launchHold.release).toHaveBeenCalledTimes(2)
  })

  it('does not hold a busy shell or a pane whose agent is not monitored', async () => {
    const off: QuotaConfig = { ...DEFAULT_QUOTA_CONFIG, agents: { ...DEFAULT_QUOTA_CONFIG.agents, codex: { ...DEFAULT_QUOTA_CONFIG.agents.codex, enabled: false } } }
    const { engine, launchHold } = setup(off)
    engine.setInputs({ sessionIds: ['s1'], busy: { s1: true } })
    engine.noteLaunch('s1', 'claude')
    engine.setInputs({ sessionIds: ['s1'], busy: {} })
    engine.noteLaunch('s1', 'codex')
    expect(launchHold.hold).not.toHaveBeenCalled()
  })

  it('releases the hold when the detected agent turns out to be unmonitored', async () => {
    const { api, engine, launchHold, probe, run } = setup()
    engine.noteLaunch('s1', 'claude')
    updateQuota((state) => ({ ...state, config: { ...state.config, agents: { ...state.config.agents, claude: { ...state.config.agents.claude, enabled: false } } } }))
    api.detect.mockResolvedValue([agent()])
    await run(T0 + 1_000)
    expect(probe).not.toHaveBeenCalled()
    expect(launchHold.release).toHaveBeenCalledWith('s1')
  })

  it('releases every pending hold when it stops', async () => {
    const { engine, launchHold } = setup()
    engine.noteLaunch('s1', 'claude')
    engine.stop()
    expect(launchHold.release).toHaveBeenCalledWith('s1')
  })
})
