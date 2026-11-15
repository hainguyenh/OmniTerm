import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentQuotaAPI } from '../agentQuotaAPI'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { QuotaEngine } from '../quotaEngine'
import { getQuotaNow, resetQuotaStore, setQuotaNow, subscribeQuota, updateQuota } from '../quotaStore'

const T0 = 1_700_000_000_000

function setup({ enabled = true, visible = true } = {}) {
  let now = T0
  let shown = visible
  const api: AgentQuotaAPI = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => []),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] })),
    resume: vi.fn(async () => 0),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 0),
    fetchUsage: vi.fn(async () => ({ windows: [], fetchedAt: now })),
    wake: vi.fn(async () => ({ ok: true })),
  }
  const delays: number[] = []
  const pending: Array<() => void> = []
  const engine = new QuotaEngine({
    api,
    now: () => now,
    random: () => 0,
    setTimer: (run, ms) => {
      delays.push(ms)
      pending.push(run)
      return pending.length
    },
    clearTimer: vi.fn(),
    visible: () => shown,
  })
  updateQuota((state) => ({ ...state, config: { ...DEFAULT_QUOTA_CONFIG, enabled } }))
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    api, engine, delays, flush,
    advance: (ms: number) => { now += ms },
    setVisible: (next: boolean) => { shown = next },
  }
}

beforeEach(() => {
  resetQuotaStore()
  setQuotaNow(0)
})
afterEach(() => resetQuotaStore())

describe('the quota engine loop', () => {
  it('advances the countdown clock without touching the quota store', async () => {
    const { engine, flush } = setup()
    const heard = vi.fn()
    const stop = subscribeQuota(heard)
    await engine.tick()
    await engine.settle()
    expect(getQuotaNow()).toBe(T0)
    // Detection found nothing and no profile changed: the store's subscribers are not woken.
    heard.mockClear()
    await engine.tick()
    await flush()
    expect(heard).not.toHaveBeenCalled()
    stop()
  })

  it('lets the clock stand still while the window is hidden', async () => {
    const { engine, advance, setVisible } = setup({ visible: false })
    await engine.tick()
    expect(getQuotaNow()).toBe(0)
    setVisible(true)
    advance(5_000)
    await engine.tick()
    expect(getQuotaNow()).toBe(T0 + 5_000)
  })

  it('ticks rarely and reads nothing while Agent Quota is off, and at once when poked', async () => {
    const { api, engine, delays, flush } = setup({ enabled: false })
    engine.start()
    await flush()
    expect(api.detect).not.toHaveBeenCalled()
    expect(getQuotaNow()).toBe(0)
    expect(delays).toEqual([15_000])

    updateQuota((state) => ({ ...state, config: { ...state.config, enabled: true } }))
    engine.poke()
    await flush()
    await engine.settle()
    expect(api.detect).toHaveBeenCalledTimes(1)
    expect(delays.at(-1)).toBe(1_000)
    engine.stop()
  })

  it('asks for a fresh process table only while a launch is being watched', async () => {
    const { api, engine } = setup()
    await engine.tick()
    expect(api.detect).toHaveBeenLastCalledWith(false)
  })
})
