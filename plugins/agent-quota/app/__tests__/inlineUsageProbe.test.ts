import { describe, expect, it } from 'vitest'

import type { TerminalAgent } from '../quotaStore'

import { canProbeInline, probeUsageInline, type ProbeIO } from '../inlineUsageProbe'

const T0 = Date.UTC(2026, 8, 25, 3, 0)

const terminal = (overrides: Partial<TerminalAgent> = {}): TerminalAgent => ({
  sessionId: 's1', agent: 'claude', pid: 1, startTime: T0 / 1000 - 5, profileDir: 'C:\\p', profileName: 'claude-work',
  subAgentCount: 0, launcher: 'claude-work', instanceKey: 's1:1:x', profileKey: 'claude:launcher:claude-work', ...overrides,
})

const PANEL = [
  '\x1b[1mCurrent session\x1b[0m',
  '██████                                         19% used',
  'Resets 3pm (America/Los_Angeles)',
  '',
  '\x1b[1mCurrent week (all models)\x1b[0m',
  '███                                               8% used',
  '',
].join('\r\n')

/** A fake pane: virtual clock, recorded input, and an agent that answers `/usage` with `reply`. */
function fakeIO(reply: string | null, typedDuringHold = '', typedBefore?: number) {
  let now = T0
  const sent: string[] = []
  let onOutput: ((text: string) => void) | null = null
  let held = false
  const io: ProbeIO = {
    send: (_id, data) => {
      sent.push(data)
      if (data === '\r' && reply !== null) onOutput?.(reply)
    },
    tap: (_id, cb) => {
      onOutput = cb
      return () => { onOutput = null }
    },
    hold: () => {
      held = true
      return () => {
        held = false
        return typedDuringHold
      }
    },
    lastUserInputAt: () => typedBefore,
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return { io, sent, isHeld: () => held }
}

describe('inline /usage probe', () => {
  it('types /usage, parses the panel, closes it and hands back what was typed meanwhile', async () => {
    const { io, sent, isHeld } = fakeIO(PANEL, 'hel')
    const snapshot = await probeUsageInline(terminal(), io)

    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['/usage', '\r', '\x1b', 'hel'])
    expect(isHeld()).toBe(false)
  })

  it('gives up after the timeout, still closing the panel and releasing input', async () => {
    const { io, sent, isHeld } = fakeIO('What\'s contributing to your limits usage?\r\nLast 24h · 1116 requests')
    expect(await probeUsageInline(terminal(), io)).toBeNull()
    expect(sent.slice(-1)).toEqual(['\x1b'])
    expect(isHeld()).toBe(false)
  })

  it('never touches an agent that is not fresh, or that the user already typed into', () => {
    const { io } = fakeIO(PANEL)
    expect(canProbeInline(terminal(), io)).toBe(true)
    expect(canProbeInline(terminal({ startTime: T0 / 1000 - 120 }), io)).toBe(false)
    expect(canProbeInline(terminal({ agent: 'codex' }), io)).toBe(false)
    const typed = fakeIO(PANEL, '', T0 - 1_000)
    expect(canProbeInline(terminal(), typed.io)).toBe(false)
  })

  it('does not send anything when it declines', async () => {
    const { io, sent } = fakeIO(PANEL, '', T0 - 1_000)
    expect(await probeUsageInline(terminal(), io)).toBeNull()
    expect(sent).toEqual([])
  })
})
