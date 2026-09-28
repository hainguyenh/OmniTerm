/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { TerminalAgent } from '../quotaStore'

import { UsageProbeOverlay } from '../UsageProbeOverlay'
import { probeUsageInline, type ProbeIO } from '../inlineUsageProbe'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const codex: TerminalAgent = {
  sessionId: 's1', agent: 'codex', pid: 1, startTime: T0 / 1000 - 2, profileDir: null, profileName: 'codex',
  subAgentCount: 0, launcher: null, instanceKey: 's1:1:x', profileKey: 'codex:codex',
}

describe('UsageProbeOverlay', () => {
  it('veils the pane with the command being typed, only while the probe owns it', async () => {
    let now = T0
    let wake: () => void = () => {}
    const io: ProbeIO = {
      send: () => {},
      tap: () => () => {},
      hold: () => () => '',
      lastUserInputAt: () => undefined,
      screen: () => ['› '],
      now: () => now,
      // The first wait parks the probe so the frozen pane can be looked at.
      sleep: (ms) => new Promise<void>((resolve) => {
        now += ms
        wake = resolve
      }),
    }
    render(<UsageProbeOverlay sessionId="s1" />)
    expect(screen.queryByTestId('usage-probe-overlay')).toBeNull()

    let done = false
    const probe = probeUsageInline(codex, io).then(() => { done = true })
    await act(async () => {})
    expect(screen.getByTestId('usage-probe-overlay')).toHaveTextContent('Reading quota with /status')

    while (!done) await act(async () => { wake() })
    await probe
    expect(screen.queryByTestId('usage-probe-overlay')).toBeNull()
  })
})
