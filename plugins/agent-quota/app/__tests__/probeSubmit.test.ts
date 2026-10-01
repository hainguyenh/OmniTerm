import { describe, expect, it } from 'vitest'

import type { TerminalAgent } from '../quotaStore'

import { probeUsageInline, type ProbeIO } from '../inlineUsageProbe'
import { isShellScreen, readUsageScreen } from '../usageProbeCore'
import { PERMISSIONS_TRUST, PERMISSIONS_TRUST_ON_YES } from './trustScreens'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const PROMPT = ['╭──────────────╮', '│ >            │', '╰──────────────╯', '  ? for shortcuts']
const TYPED = ['╭──────────────╮', '│ > /usage     │', '╰──────────────╯']
const PANEL = ['Current session', '██████   19% used', 'Resets 3pm (UTC)', '', 'Current week (all models)', '███   8% used']
const SHELL = ['PS D:\\workspace\\OmniTerm> ']

const terminal: TerminalAgent = {
  sessionId: 's1', agent: 'claude', pid: 1, startTime: T0 / 1000 - 5, profileDir: 'C:\\p', profileName: 'claude-work',
  subAgentCount: 0, launcher: 'claude-work', instanceKey: 's1:1:x', profileKey: 'claude:launcher:claude-work',
}

interface PaneOptions {
  start: string[]
  /** Enters the agent drops before one submits `/usage` (a busy app). */
  droppedEnters?: number
  /** Whether a Down arrow moves the trust cursor. */
  arrowsWork?: boolean
  /** Whether the typed command is drawn on the prompt. */
  echo?: boolean
}

/** A Claude-like pane on a virtual clock: trust dialog, prompt, echo, and a panel on Enter. */
function fakePane(options: PaneOptions) {
  let now = T0
  let screen = options.start
  let typed = ''
  let dropped = options.droppedEnters ?? 0
  const sent: string[] = []
  let onOutput: ((text: string) => void) | null = null
  const draw = (next: string[]) => {
    screen = next
    onOutput?.(next.join('\r\n'))
  }
  const io: ProbeIO = {
    send: (_id, data) => {
      sent.push(data)
      if (screen === PERMISSIONS_TRUST && data === '\x1b[B' && options.arrowsWork !== false) return draw(PERMISSIONS_TRUST_ON_YES)
      if (screen === PERMISSIONS_TRUST && data === '\r') return draw(SHELL)
      if (screen === PERMISSIONS_TRUST_ON_YES && data === '\r') return draw(PROMPT)
      if (screen === SHELL) return
      if (data === '/usage') {
        typed = data
        if (options.echo !== false) draw(TYPED)
        return
      }
      if (data === '\r' && typed) {
        if (dropped > 0) {
          dropped -= 1
          return
        }
        typed = ''
        draw([...PROMPT, ...PANEL])
      }
    },
    tap: (_id, cb) => {
      onOutput = cb
      return () => { onOutput = null }
    },
    hold: () => () => '',
    lastUserInputAt: () => undefined,
    screen: () => screen,
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return { io, sent }
}

describe('inline probe: trust dialogs and a busy app', () => {
  it('arrows down to "Yes, I trust this folder" before confirming, then reads quota (regression)', async () => {
    const { io, sent } = fakePane({ start: PERMISSIONS_TRUST })
    const snapshot = await probeUsageInline(terminal, io)

    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['\x1b[B', '\r', '/usage', '\r', '\x1b'])
  })

  it('never presses Enter on "No, exit" when the cursor does not move, and types nothing else', async () => {
    const { io, sent } = fakePane({ start: PERMISSIONS_TRUST, arrowsWork: false })
    expect(await probeUsageInline(terminal, io)).toBeNull()
    expect(sent).toEqual(['\x1b[B'])
  })

  it('never types the command into a shell the agent left behind (regression)', async () => {
    const { io, sent } = fakePane({ start: SHELL })
    expect(await probeUsageInline(terminal, io)).toBeNull()
    expect(sent).toEqual([])
  })

  it('presses Enter again while the command still sits on the prompt', async () => {
    const { io, sent } = fakePane({ start: PROMPT, droppedEnters: 2 })
    const snapshot = await probeUsageInline(terminal, io)

    expect(snapshot?.windows[0]).toMatchObject({ kind: 'session', usedPct: 19 })
    expect(sent).toEqual(['/usage', '\r', '\r', '\r', '\x1b'])
  })

  it('gives up after two extra Enters, still closing the panel', async () => {
    const { io, sent } = fakePane({ start: PROMPT, droppedEnters: 5 })
    expect(await probeUsageInline(terminal, io)).toBeNull()
    expect(sent).toEqual(['/usage', '\r', '\r', '\r', '\x1b'])
  })

  it('still submits when the prompt never draws the command', async () => {
    const { io, sent } = fakePane({ start: PROMPT, echo: false })
    const snapshot = await probeUsageInline(terminal, io)
    expect(snapshot?.windows[0]).toMatchObject({ kind: 'session', usedPct: 19 })
    expect(sent).toEqual(['/usage', '\r', '\x1b'])
  })
})

describe('isShellScreen', () => {
  it('spots a bare shell prompt, not an agent status line', () => {
    expect(isShellScreen(SHELL)).toBe(true)
    expect(isShellScreen(['C:\\Users\\me>'])).toBe(true)
    expect(isShellScreen(['me@box:~/src$ '])).toBe(true)
    expect(isShellScreen(PROMPT)).toBe(false)
    expect(isShellScreen([...PROMPT, '  Context left 45%'])).toBe(false)
  })
})

describe('readUsageScreen', () => {
  it('reads the panel on screen, preferring the one after the last command', () => {
    const old = ['Current session', '█   2% used', '']
    const snapshot = readUsageScreen('claude', [...old, '> /usage', ...PANEL], T0)
    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(snapshot?.fetchedAt).toBe(T0)
  })

  it('finds nothing without a panel', () => {
    expect(readUsageScreen('claude', PROMPT, T0)).toBeNull()
    expect(readUsageScreen('claude', [...PROMPT, '> /usage'], T0)).toBeNull()
  })
})
