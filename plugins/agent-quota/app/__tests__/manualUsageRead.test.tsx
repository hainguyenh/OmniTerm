/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../../src/types'
import type { AgentQuotaAPI, SessionAgent } from '../agentQuotaAPI'

import { AWAIT_USAGE_MS } from '../manualUsageRead'
import { QuotaPaneLines } from '../paneHosts'
import { QuotaEngine } from '../quotaEngine'
import { getQuotaState, registerQuotaCommands, resetQuotaStore, updateQuota } from '../quotaStore'

import { NOW, seed, terminal } from './quotaFixtures'

const PROMPT = ['╭──────────────╮', '│ >            │', '╰──────────────╯']
const PANEL = ['> /usage', 'Current session', '██████   19% used', 'Resets 3pm (UTC)', '', 'Current week (all models)', '███   8% used']

const row: SessionAgent = {
  sessionId: 's1', agent: 'claude', pid: 10, startTime: 100, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null,
}

function setup() {
  let now = NOW
  let rows = [row]
  let paneScreen: string[] | null = PROMPT
  const background: QuotaSnapshot = { windows: [{ kind: 'session', label: 's', usedPct: 40 }], fetchedAt: NOW }
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => rows),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async () => background),
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const engine = new QuotaEngine({
    api,
    now: () => now,
    random: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    readScreen: () => paneScreen,
  })
  engine.setInputs({ sessionIds: ['s1'], busy: {} })
  const run = async () => {
    await engine.tick()
    await engine.settle()
  }
  const sessionPct = () => getQuotaState().profiles['claude:c:\\p\\work']?.lastGood?.windows[0]?.usedPct
  return {
    engine, run, sessionPct,
    show: (next: string[] | null) => { paneScreen = next },
    advance: (ms: number) => { now += ms },
    closeTerminal: () => { rows = [] },
  }
}

beforeEach(() => resetQuotaStore())

describe('manual usage read', () => {
  it('records the usage panel already on screen into the profile', async () => {
    const pane = setup()
    await pane.run()
    expect(pane.sessionPct()).toBe(40)

    pane.show([...PROMPT, ...PANEL])
    pane.engine.readUsage('s1')
    await pane.engine.settle()

    expect(pane.sessionPct()).toBe(19)
    expect(getQuotaState().awaitingUsage).toEqual({})
    expect(getQuotaState().notices.at(-1)).toMatchObject({ level: 'info', message: expect.stringContaining('usage panel') })
  })

  it('without a panel, waits for the one the user opens and records it', async () => {
    const pane = setup()
    await pane.run()
    pane.engine.readUsage('s1')
    expect(getQuotaState().awaitingUsage).toEqual({ s1: NOW })

    pane.advance(1_000)
    await pane.run()
    expect(getQuotaState().awaitingUsage).toEqual({ s1: NOW })

    pane.show([...PROMPT, ...PANEL])
    pane.advance(1_000)
    await pane.run()
    expect(pane.sessionPct()).toBe(19)
    expect(getQuotaState().awaitingUsage).toEqual({})
  })

  it('stops waiting when cancelled, when the terminal goes, or after the wait lapses', async () => {
    const pane = setup()
    await pane.run()
    pane.engine.readUsage('s1')
    pane.engine.cancelUsageRead('s1')
    expect(getQuotaState().awaitingUsage).toEqual({})

    pane.engine.readUsage('s1')
    pane.advance(AWAIT_USAGE_MS)
    await pane.run()
    expect(getQuotaState().awaitingUsage).toEqual({})
    expect(getQuotaState().notices.at(-1)).toMatchObject({ level: 'warning' })
    expect(pane.sessionPct()).toBe(40)

    pane.engine.readUsage('s1')
    pane.closeTerminal()
    pane.advance(5_000)
    await pane.run()
    expect(getQuotaState().awaitingUsage).toEqual({})
  })
})

describe('strip read button', () => {
  it('sits next to the wake clock and asks for a read, then shows the callout while waiting', () => {
    const readUsage = vi.fn()
    const cancelUsageRead = vi.fn()
    registerQuotaCommands({ readUsage, cancelUsageRead })
    seed()
    render(<QuotaPaneLines sessionId="s1" />)

    const button = screen.getByRole('button', { name: 'Read quota from the /usage panel on screen' })
    expect(button.previousElementSibling).toHaveAccessibleName(/scheduled wake-up/)
    fireEvent.click(button)
    expect(readUsage).toHaveBeenCalledWith('s1')
    expect(screen.queryByTestId('aq-usage-callout')).toBeNull()

    act(() => updateQuota((state) => ({ ...state, awaitingUsage: { s1: NOW } })))
    expect(screen.getByTestId('aq-usage-callout')).toHaveTextContent('Type /usage in this agent')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting for the usage panel' }))
    fireEvent.click(button)
    expect(cancelUsageRead).toHaveBeenCalledTimes(2)
  })

  it('names Codex\'s own command', () => {
    seed({ terminals: [terminal({ agent: 'codex' })] })
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByRole('button', { name: 'Read quota from the /status panel on screen' })).toBeInTheDocument()
  })
})
