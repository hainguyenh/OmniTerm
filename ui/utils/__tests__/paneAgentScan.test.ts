import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetPaneAgentScan, ROUTINE_SCAN_AGE_MS, scanPaneAgents } from '../paneAgentScan'

afterEach(() => resetPaneAgentScan())

function fake() {
  let now = 1_000
  let walks = 0
  const scan = vi.fn(async () => [{ walk: ++walks }])
  resetPaneAgentScan({ scan, now: () => now })
  return { scan, advance: (ms: number) => { now += ms } }
}

describe('scanPaneAgents', () => {
  it('lets both pollers share one walk of the process table', async () => {
    const { scan, advance } = fake()
    expect(await scanPaneAgents()).toEqual([{ walk: 1 }])
    advance(2_500)
    // Session persistence polls between two Agent Quota polls: the same reading answers it.
    expect(await scanPaneAgents()).toEqual([{ walk: 1 }])
    advance(ROUTINE_SCAN_AGE_MS)
    expect(await scanPaneAgents()).toEqual([{ walk: 2 }])
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('walks again for a caller that needs this moment, and joins a walk already running', async () => {
    const { scan } = fake()
    await scanPaneAgents()
    const [a, b] = await Promise.all([scanPaneAgents(0), scanPaneAgents(0)])
    expect(a).toEqual([{ walk: 2 }])
    expect(b).toBe(a)
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('does not remember a failed walk', async () => {
    const scan = vi.fn().mockRejectedValueOnce(new Error('ipc')).mockResolvedValueOnce(['ok'])
    resetPaneAgentScan({ scan, now: () => 0 })
    await expect(scanPaneAgents()).rejects.toThrow('ipc')
    expect(await scanPaneAgents()).toEqual(['ok'])
  })
})
