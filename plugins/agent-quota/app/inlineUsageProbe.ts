/**
 * Inline quota read when an agent starts in a terminal — a fresh launch or a resume.
 *
 * `claude -p /usage` sometimes answers with only the "What's contributing to your limits usage?"
 * report, and Codex writes its limits to disk only after its first reply, so a freshly opened agent
 * could show no quota for a while. When a new agent process appears, just started and not yet typed
 * into, OmniTerm asks it directly: the pane is frozen (input held and the pane veiled), the agent's
 * own command (`/usage`; `/status` for Codex) is typed into it, the panel it draws is read from the
 * pane's screen, the panel is closed (Esc), and the pane is released with anything typed meanwhile.
 * If any step fails the engine falls back to the background read.
 *
 * A resume picker or a first-run dialog (folder trust, login) needs the user, and typing into it
 * would pick for them: the probe hands the keyboard back at once, waits for it to close, and asks
 * only if nothing was typed after that.
 */
import { useSyncExternalStore } from 'react'

import type { AgentKind, QuotaError, QuotaSnapshot, QuotaWindow } from '../src/types'
import type { TerminalAgent } from './quotaStore'

import { parseAgyUsage } from '../src/agyUsageParser'
import { parseClaudeUsage } from '../src/claudeUsageParser'
import { parseCodexStatus } from '../src/codexStatusParser'
import { tapSessionOutput } from '../../../ui/tauriSessions'
import { holdPaneInput, lastUserInputAt } from '../../../ui/utils/paneInputHold'
import { readPaneScreen } from '../../../ui/utils/paneScreens'

/** Only an agent this young is still at its empty prompt (or its resume picker). */
export const PROBE_MAX_AGE_S = 30
/**
 * Process start times are whole seconds, and the Enter that launched the agent lands in that same
 * second (earlier still behind a launcher script) — so only input after this counts as typing into
 * the agent. Comparing against the bare start second declined nearly every launch.
 */
const LAUNCH_GRACE_MS = 1_500
const QUIET_MS = 700
const MAX_SETTLE_MS = 6_000
/** How long a picker or dialog may stay up before the probe gives up and the background read runs. */
const MAX_DIALOG_WAIT_MS = 120_000
const DIALOG_POLL_MS = 250
const REPLY_TIMEOUT_MS = 8_000
/**
 * The command arrives as one chunk, which Codex's composer takes for a paste; an Enter right after a
 * paste burst inserts a newline instead of submitting, so the Enter waits well past that window.
 */
const SUBMIT_DELAY_MS = 300
const CLOSE_DELAY_MS = 150

type UsageParse = { ok: true; windows: QuotaWindow[] } | { ok: false; error: QuotaError }

interface AgentProbe {
  command: string
  /**
   * Closes the panel the command opens. Codex prints `/status` into its history instead, and an Esc
   * there would arm its "edit previous message" shortcut.
   */
  close?: string
  /** Also parse the raw byte stream: Claude's panel is plain lines; Codex paints with cursor moves. */
  stream: boolean
  parse(text: string, now: number): UsageParse
}

const AGENT_PROBES: Record<AgentKind, AgentProbe> = {
  claude: { command: '/usage', close: '\x1b', stream: true, parse: parseClaudeUsage },
  codex: { command: '/status', stream: false, parse: parseCodexStatus },
  agy: { command: '/usage', close: '\x1b', stream: true, parse: parseAgyUsage },
}

/**
 * A screen that is waiting on a choice: a resume picker, a folder-trust or login prompt, or any
 * list with a selected numbered option (`❯ 1. Yes, proceed`). Prose lines quoting a `>` prompt are
 * not a selection, so only the agents' own selection markers count.
 */
const BLOCKING_SCREEN = [
  /\bresume (?:a previous )?session\b/i,
  /\btype to search\b/i,
  /\btrust (?:the files|this (?:folder|directory|project))\b/i,
  /\bpress enter to continue\b/i,
  /^[\s│┃|]*[❯›]\s*\d+[.)]\s+\S/,
]

export function isBlockingScreen(lines: readonly string[]): boolean {
  return lines.some((line) => BLOCKING_SCREEN.some((pattern) => pattern.test(line)))
}

export interface ProbeIO {
  send(sessionId: string, data: string): void
  tap(sessionId: string, onOutput: (text: string) => void): () => void
  hold(sessionId: string): () => string
  lastUserInputAt(sessionId: string): number | undefined
  /** The pane's rendered bottom page; null when the pane is not in this window. */
  screen(sessionId: string): string[] | null
  now(): number
  sleep(ms: number): Promise<void>
}

/** Session → the command being typed into it, while the probe owns that pane. */
const probing = new Map<string, string>()
const listeners = new Set<() => void>()

function setProbing(sessionId: string, command: string | null): void {
  if (command) probing.set(sessionId, command)
  else probing.delete(sessionId)
  for (const listener of listeners) listener()
}

/** The command the probe is typing into this pane, or null — the pane is veiled while it runs. */
export function useUsageProbe(sessionId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => probing.get(sessionId) ?? null,
    () => null,
  )
}

/** Whether this terminal's agent is fresh enough, and untouched, for an inline probe. */
export function canProbeInline(terminal: TerminalAgent, io: Pick<ProbeIO, 'lastUserInputAt' | 'now'>): boolean {
  if (!Object.hasOwn(AGENT_PROBES, terminal.agent)) return false
  const startedMs = terminal.startTime * 1000
  if (io.now() - startedMs > PROBE_MAX_AGE_S * 1000) return false
  const typed = io.lastUserInputAt(terminal.sessionId)
  return typed === undefined || typed < startedMs + LAUNCH_GRACE_MS
}

/** Resolves once no output has arrived for `quietMs`, or after `maxMs`. */
async function waitForQuiet(io: ProbeIO, changedAt: () => number, quietMs: number, maxMs: number): Promise<void> {
  const start = io.now()
  while (io.now() - start < maxMs) {
    if (io.now() - changedAt() >= quietMs) return
    await io.sleep(100)
  }
}

/** When the picker or dialog on screen went away; null if it outlasted the wait or the pane closed. */
async function waitForUnblocked(io: ProbeIO, sessionId: string): Promise<number | null> {
  const start = io.now()
  while (io.now() - start < MAX_DIALOG_WAIT_MS) {
    const screen = io.screen(sessionId)
    if (!screen) return null
    if (!isBlockingScreen(screen)) return io.now()
    await io.sleep(DIALOG_POLL_MS)
  }
  return null
}

/**
 * Parse the reply from what the command added to the screen: lines already there before it was
 * typed (a resumed transcript, an old panel) are left out, so nothing stale is read as the answer.
 */
function readReply(probe: AgentProbe, screen: string[] | null, before: ReadonlySet<string>, stream: string, now: number): UsageParse | null {
  const fresh = (screen ?? []).filter((line) => line.trim() !== '' && !before.has(line)).join('\n')
  const fromScreen = fresh ? probe.parse(fresh, now) : null
  if (fromScreen?.ok || !probe.stream || !stream) return fromScreen
  const fromStream = probe.parse(stream, now)
  return fromStream.ok || fromStream.error === 'not_signed_in' ? fromStream : fromScreen
}

export async function probeUsageInline(terminal: TerminalAgent, io: ProbeIO): Promise<QuotaSnapshot | null> {
  if (!canProbeInline(terminal, io)) return null
  const { sessionId } = terminal
  const probe = AGENT_PROBES[terminal.agent]
  if (!io.screen(sessionId)) return null
  let output = ''
  let lastOutputAt = io.now()
  const untap = io.tap(sessionId, (text) => {
    output += text
    lastOutputAt = io.now()
  })
  const freeze = () => {
    const release = io.hold(sessionId)
    setProbing(sessionId, probe.command)
    return () => {
      const typed = release()
      setProbing(sessionId, null)
      if (typed) io.send(sessionId, typed)
    }
  }
  let unfreeze: (() => void) | null = freeze()
  let sent = false
  try {
    // Let the agent finish drawing its first screen before typing into it.
    await waitForQuiet(io, () => lastOutputAt, QUIET_MS, MAX_SETTLE_MS)
    if (isBlockingScreen(io.screen(sessionId) ?? [])) {
      unfreeze()
      unfreeze = null
      const clearedAt = await waitForUnblocked(io, sessionId)
      const typed = io.lastUserInputAt(sessionId)
      // Keys typed after the picker closed went to the agent's prompt: the user has taken over.
      if (clearedAt === null || (typed !== undefined && typed > clearedAt)) return null
      unfreeze = freeze()
      await waitForQuiet(io, () => lastOutputAt, QUIET_MS, MAX_SETTLE_MS)
      if (isBlockingScreen(io.screen(sessionId) ?? [])) return null
    }
    const before = new Set(io.screen(sessionId) ?? [])
    output = ''
    sent = true
    io.send(sessionId, probe.command)
    await io.sleep(SUBMIT_DELAY_MS)
    io.send(sessionId, '\r')
    const started = io.now()
    while (io.now() - started < REPLY_TIMEOUT_MS) {
      const parsed = readReply(probe, io.screen(sessionId), before, output, io.now())
      if (parsed?.ok) return { windows: parsed.windows, fetchedAt: io.now(), source: 'cli' }
      if (parsed?.error === 'not_signed_in') return null
      await io.sleep(150)
    }
    return null
  } finally {
    untap()
    // Close the panel whether or not it parsed, then give the agent back its keyboard.
    if (sent && probe.close) {
      io.send(sessionId, probe.close)
      await io.sleep(CLOSE_DELAY_MS)
    }
    unfreeze?.()
  }
}

/** The real pane I/O: the session's input channel, an output tap, the input hold and the screen. */
export const LIVE_PROBE_IO: ProbeIO = {
  send: (sessionId, data) => { void window.omnitermAPI?.connect?.localInput?.(sessionId, data) },
  tap: (sessionId, onOutput) => {
    // One decoder per tap: a multi-byte character split across chunks must not leak between panes.
    const decoder = new TextDecoder()
    return tapSessionOutput(sessionId, (bytes) => onOutput(decoder.decode(bytes, { stream: true })))
  },
  hold: holdPaneInput,
  lastUserInputAt,
  screen: readPaneScreen,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
