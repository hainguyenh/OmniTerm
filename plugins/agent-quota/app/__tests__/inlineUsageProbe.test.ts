import { describe, expect, it } from 'vitest'

import type { TerminalAgent } from '../quotaStore'

import { canProbeInline, isBlockingScreen, isTrustScreen, probeUsageInline, type ProbeIO } from '../inlineUsageProbe'

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

const PROMPT = ['╭──────────────╮', '│ >            │', '╰──────────────╯', '  ? for shortcuts']
const CODEX_STATUS = [
  '│  Session:          019a7c2e-5f7d                                  │',
  '│  5h limit:         [███████░░░░░░░░░░░░░] 35% used (resets 18:40) │',
  '│  Weekly limit:     [██░░░░░░░░░░░░░░░░░░] 88% left                │',
]
const RESUME_PICKER = ['Resume Session', '╭──────────╮', '│ ⌕ Search… │', '╰──────────╯', '❯ 1. Fix header bug   2m ago']

interface FakeOptions {
  /** What the agent writes to its output stream when the command is submitted. */
  reply?: string | null
  /** The screen after the command is submitted. */
  replyScreen?: string[]
  typedDuringHold?: string
  typedBefore?: number
  screen?: string[] | null
}

/** A fake pane: virtual clock, recorded input, a rendered screen, and an agent that answers its command. */
function fakeIO(options: FakeOptions = {}) {
  let now = T0
  const sent: string[] = []
  let onOutput: ((text: string) => void) | null = null
  let held = false
  let screen: string[] | null = options.screen === undefined ? PROMPT : options.screen
  let typed = options.typedBefore
  const io: ProbeIO = {
    send: (_id, data) => {
      sent.push(data)
      if (data !== '\r') return
      if (options.reply) onOutput?.(options.reply)
      if (options.replyScreen) screen = [...PROMPT, ...options.replyScreen]
    },
    tap: (_id, cb) => {
      onOutput = cb
      return () => { onOutput = null }
    },
    hold: () => {
      held = true
      return () => {
        held = false
        return options.typedDuringHold ?? ''
      }
    },
    lastUserInputAt: () => typed,
    screen: () => screen,
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return {
    io, sent, isHeld: () => held,
    setScreen: (next: string[]) => { screen = next },
    type: () => { typed = now },
    advance: (ms: number) => { now += ms },
  }
}

describe('inline quota probe', () => {
  it('types /usage, parses the panel, closes it and hands back what was typed meanwhile', async () => {
    const { io, sent, isHeld } = fakeIO({ reply: PANEL, typedDuringHold: 'hel' })
    const snapshot = await probeUsageInline(terminal(), io)

    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['/usage', '\r', '\x1b', 'hel'])
    expect(isHeld()).toBe(false)
  })

  it('auto-confirms folder trust prompt, then sends /usage and reads quota', async () => {
    const TRUST_PROMPT = [
      'Quick safety check: Do you trust the authors of the files in this folder?',
      '[1] Yes, trust this folder (default)',
      '[2] No, exit',
    ]
    const { io, sent } = fakeIO({ screen: TRUST_PROMPT, reply: PANEL })
    let current = TRUST_PROMPT
    io.screen = () => current
    const originalSend = io.send
    io.send = (id, data) => {
      originalSend(id, data)
      if (data === '1\r') {
        current = PROMPT
      }
    }
    const snapshot = await probeUsageInline(terminal(), io)

    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['1\r', '/usage', '\r', '\x1b'])
  })

  it('reads Codex with /status from the rendered screen and sends no Esc', async () => {
    const { io, sent } = fakeIO({ replyScreen: CODEX_STATUS })
    const snapshot = await probeUsageInline(terminal({ agent: 'codex', profileKey: 'codex:c:\\p' }), io)

    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 35], ['weekly', 12]])
    expect(sent).toEqual(['/status', '\r'])
  })

  it('reads Antigravity with /usage', async () => {
    const { io, sent } = fakeIO({ replyScreen: ['Gemini Models   Five Hour Limit Remaining  82%   2026-09-25T07:11:00Z'] })
    const snapshot = await probeUsageInline(terminal({ agent: 'agy', profileKey: 'agy:c:\\p' }), io)

    expect(snapshot?.windows).toEqual([expect.objectContaining({ kind: 'session', usedPct: 18 })])
    expect(sent).toEqual(['/usage', '\r', '\x1b'])
  })

  it('does not read a reading that was already on screen before the command', async () => {
    const { io } = fakeIO({ screen: [...PROMPT, ...CODEX_STATUS], replyScreen: [] })
    expect(await probeUsageInline(terminal({ agent: 'codex' }), io)).toBeNull()
  })

  it('reads usage reply when a previous session already printed usage in scrollback', async () => {
    const previousScrollback = [...PROMPT, ...PANEL.split('\r\n'), 'PS C:\\> claude', ...PROMPT]
    const { io } = fakeIO({ screen: previousScrollback, replyScreen: PANEL.split('\r\n') })
    const snapshot = await probeUsageInline(terminal(), io)
    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
  })

  it('reads usage when previous session had trust prompt in scrollback and user exited', async () => {
    const previousTrustScrollback = [
      'Quick safety check: Do you trust the authors of the files in this folder?',
      '[1] Yes, trust this folder',
      '❯ /exit',
      'PS C:\\> claude-other',
      ...PROMPT,
    ]
    const { io, sent } = fakeIO({ screen: previousTrustScrollback, reply: PANEL })
    const snapshot = await probeUsageInline(terminal(), io)
    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['/usage', '\r', '\x1b'])
  })

  it('auto-confirms chained folder and environment trust prompts', async () => {
    const TRUST_1 = ['Quick safety check: Do you trust the authors of the files in this folder?', '[1] Yes, trust this folder', '[2] No, exit']
    const TRUST_2 = ['Do you trust this environment?', '1. Yes, trust env', '2. No']
    let current = TRUST_1
    const { io, sent } = fakeIO({ screen: TRUST_1, reply: PANEL })
    io.screen = () => current
    const origSend = io.send
    io.send = (id, data) => {
      origSend(id, data)
      if (data === '1\r') {
        if (current === TRUST_1) current = TRUST_2
        else if (current === TRUST_2) current = PROMPT
      }
    }
    const snapshot = await probeUsageInline(terminal(), io)
    expect(snapshot?.windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    expect(sent).toEqual(['1\r', '1\r', '/usage', '\r', '\x1b'])
  })

  it('gives up after the timeout, still closing the panel and releasing input', async () => {
    const { io, sent, isHeld } = fakeIO({ reply: 'What\'s contributing to your limits usage?\r\nLast 24h · 1116 requests' })
    expect(await probeUsageInline(terminal(), io)).toBeNull()
    expect(sent.slice(-1)).toEqual(['\x1b'])
    expect(isHeld()).toBe(false)
  })

  it('waits out a resume picker with the keyboard released, then asks once it closes', async () => {
    const pane = fakeIO({ screen: RESUME_PICKER, reply: PANEL })
    const holds: boolean[] = []
    const result = probeUsageInline(terminal(), {
      ...pane.io,
      sleep: async (ms) => {
        holds.push(pane.isHeld())
        pane.advance(ms)
        // The user picks a session a few seconds in: the Enter lands just before the list closes.
        if (holds.length === 40) {
          pane.type()
          pane.setScreen(PROMPT)
        }
      },
    })
    const snapshot = await result

    expect(snapshot?.windows[0]).toMatchObject({ kind: 'session', usedPct: 19 })
    expect(pane.sent).toEqual(['/usage', '\r', '\x1b'])
    // Released while the picker was up; held again only to type the command.
    expect(holds.slice(10, 39).every((held) => !held)).toBe(true)
    expect(holds.at(-1)).toBe(true)
  })

  it('gives the pane back when the user types after the picker closed', async () => {
    const pane = fakeIO({ screen: RESUME_PICKER, reply: PANEL })
    let polls = 0
    const snapshot = await probeUsageInline(terminal(), {
      ...pane.io,
      sleep: async (ms) => {
        pane.advance(ms)
        polls += 1
        if (polls === 20) pane.setScreen(PROMPT)
        if (polls === 20) pane.advance(1)
      },
      lastUserInputAt: () => (polls >= 20 ? T0 + 60_000 : undefined),
    })
    expect(snapshot).toBeNull()
    expect(pane.sent).toEqual([])
    expect(pane.isHeld()).toBe(false)
  })

  it('never touches an agent that is not fresh, that the user already typed into, or not in this window', async () => {
    const { io } = fakeIO()
    expect(canProbeInline(terminal(), io)).toBe(true)
    expect(canProbeInline(terminal({ agent: 'codex' }), io)).toBe(true)
    expect(canProbeInline(terminal({ agent: 'unknown' as any }), io)).toBe(false)
    expect(canProbeInline(terminal({ startTime: T0 / 1000 - 120 }), io)).toBe(false)
    expect(canProbeInline(terminal(), fakeIO({ typedBefore: T0 - 1_000 }).io)).toBe(false)
    const detached = fakeIO({ screen: null, reply: PANEL })
    expect(await probeUsageInline(terminal(), detached.io)).toBeNull()
    expect(detached.sent).toEqual([])
  })

  it('declines and bails early when the agent reports it is not signed in', async () => {
    const { io } = fakeIO({ reply: 'Please run claude login to authenticate.' })
    expect(await probeUsageInline(terminal(), io)).toBeNull()
  })

  it('counts the Enter that launched the agent, within its start second, as not typing into it (regression)', () => {
    // Start times are whole seconds: the launch keystroke at .900 comes after the floored start.
    const started = terminal({ startTime: T0 / 1000 - 5 })
    expect(canProbeInline(started, fakeIO({ typedBefore: T0 - 5_000 + 900 }).io)).toBe(true)
    expect(canProbeInline(started, fakeIO({ typedBefore: T0 - 2_000 }).io)).toBe(false)
  })

  it('does not send anything when it declines', async () => {
    const { io, sent } = fakeIO({ reply: PANEL, typedBefore: T0 - 1_000 })
    expect(await probeUsageInline(terminal(), io)).toBeNull()
    expect(sent).toEqual([])
  })
})

describe('isBlockingScreen', () => {
  it('spots pickers and dialogs that need the user', () => {
    expect(isBlockingScreen(RESUME_PICKER)).toBe(true)
    expect(isBlockingScreen(['Do you trust the files in this folder?', '❯ 1. Yes, proceed'])).toBe(true)
    expect(isBlockingScreen(['  Resume a previous session', '  Type to search'])).toBe(true)
    expect(isBlockingScreen(['› 1. Yes, allow Codex to work in this folder'])).toBe(true)
  })

  it('lets an agent prompt and a quoted numbered prompt through', () => {
    expect(isBlockingScreen(PROMPT)).toBe(false)
    expect(isBlockingScreen(['> 1. first step of my earlier prompt', ...PROMPT])).toBe(false)
  })
})

describe('isTrustScreen', () => {
  it('spots folder trust checks', () => {
    expect(isTrustScreen(['Quick safety check: Do you trust the authors of the files in this folder?'])).toBe(true)
    expect(isTrustScreen(['Do you trust the files in this folder?'])).toBe(true)
    expect(isTrustScreen(['Do you trust this folder?'])).toBe(true)
    expect(isTrustScreen(['[1] Yes, trust this folder (default)'])).toBe(true)
    expect(isTrustScreen(['❯ 1. Yes, trust this project'])).toBe(true)
    expect(isTrustScreen(PROMPT)).toBe(false)
  })
})

