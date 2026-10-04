/**
 * Asking a running agent for its quota by typing its own command into its terminal and reading
 * the panel it draws. Shared by the inline probe (a pane the user just started an agent in, see
 * inlineUsageProbe.ts) and the hidden probe (a terminal no one sees, run for profiles that have
 * no open pane, see hiddenProfileProbe.ts). Neither holds the user's input here: the callers own
 * that, this module only drives the agent.
 */
import type { AgentKind, QuotaError, QuotaSnapshot, QuotaWindow } from '../src/types'

import { parseAgyUsage } from '../src/agyUsageParser'
import { parseClaudeUsage } from '../src/claudeUsageParser'
import { parseCodexStatus } from '../src/codexStatusParser'
import { planTrustAnswer } from './trustDialog'

export const QUIET_MS = 700
export const MAX_SETTLE_MS = 8_000
/** How long a reply may take after the last Enter. */
const REPLY_TIMEOUT_MS = 6_000
/** However many times Enter is pressed, the probe gives up this long after the first one. */
const MAX_REPLY_MS = 15_000
/**
 * A busy app can drop or delay the Enter: with no reply this long after it, while the command still
 * sits on the prompt (or nothing was printed at all), Enter is pressed again.
 */
const RETRY_ENTER_MS = 1_500
const MAX_ENTER_RETRIES = 2
/** How long to wait for the typed command to show on the prompt before pressing Enter anyway. */
const ECHO_WAIT_MS = 3_000
const ARROW_DELAY_MS = 100
const ARROW = { down: '\x1b[B', up: '\x1b[A' } as const
/**
 * The command arrives as one chunk, which Codex's composer takes for a paste; an Enter right after a
 * paste burst inserts a newline instead of submitting, so the Enter waits well past that window.
 */
export const SUBMIT_DELAY_MS = 300
export const CLOSE_DELAY_MS = 150
/** A folder-trust dialog is answered at most this many times before the probe gives up on it. */
const MAX_TRUST_ANSWERS = 3

export type UsageParse = { ok: true; windows: QuotaWindow[] } | { ok: false; error: QuotaError }

export interface AgentProbe {
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

export const AGENT_PROBES: Record<AgentKind, AgentProbe> = {
  claude: { command: '/usage', close: '\x1b', stream: true, parse: parseClaudeUsage },
  codex: { command: '/status', stream: false, parse: parseCodexStatus },
  agy: { command: '/usage', close: '\x1b', stream: true, parse: parseAgyUsage },
}

const TRUST_SCREEN = [
  /\bquick safety check\b/i,
  /\bdo you trust (?:the (?:authors|files)|this (?:folder|directory|project|environment|env|workspace))\b/i,
  /\btrust (?:the (?:authors|files)|this (?:folder|directory|project|environment|env|workspace))\b/i,
  /\byes, trust (?:this )?(?:folder|directory|project|environment|env|workspace)\b/i,
  /\btrust this (?:folder|directory|project|environment|env|workspace)\b/i,
  /\btrust (?:folder|environment|env|workspace)\b/i,
  /\btrust the authors\b/i,
  /^\s*[❯›]?\s*1[.)]\s+Yes.*trust/im,
  /\bdo you trust\b/i,
  /\bYes,\s*(?:I\s*)?trust\b/i,
  /\bYes,\s*proceed\b/i,
]

const PROMPT_MARKER = [
  /^[│┃|]\s*>/,
  /^[❯›>]\s*$/,
  /^[❯›>]\s+(?!1[.)]|\(1\)|\[1\])\S/,
  /^(?:[a-zA-Z]:[\\/]|[\w.-]+@|PS\b|[$#]\s)/,
  /\? for (?:shortcuts|help)/i,
]

function hasPromptAfter(lines: readonly string[], matchIdx: number): boolean {
  for (let i = matchIdx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (PROMPT_MARKER.some((re) => re.test(line))) return true
  }
  return false
}

export function isTrustScreen(lines: readonly string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (TRUST_SCREEN.some((pattern) => pattern.test(lines[i]))) {
      return !hasPromptAfter(lines, i)
    }
  }
  return false
}

/**
 * A screen that is waiting on a choice: a resume picker, a folder-trust or login prompt, or any
 * list with a selected numbered option (`❯ 1. Yes, proceed`). Prose lines quoting a `>` prompt are
 * not a selection, so only the agents' own selection markers count.
 */
const BLOCKING_SCREEN = [
  /\bresume (?:a previous )?session\b/i,
  /\btype to search\b/i,
  /\btrust (?:the (?:authors|files)|this (?:folder|directory|project|environment|env|workspace))\b/i,
  /\bquick safety check\b/i,
  /\bdo you trust\b/i,
  /\bpress enter to continue\b/i,
  /^[\s│┃|]*[❯›]\s*\d+[.)]\s+\S/,
  /^[\s│┃|]*\[\d+\]\s+\S/,
]

export function isBlockingScreen(lines: readonly string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (BLOCKING_SCREEN.some((pattern) => pattern.test(lines[i]))) {
      return !hasPromptAfter(lines, i)
    }
  }
  return false
}

/**
 * The agent is gone and its shell is back (a bare PowerShell, cmd or POSIX prompt at the bottom):
 * nothing may be typed then. Narrower than a generic prompt match, so an agent's status line that
 * ends in `%` still counts as the agent.
 */
const SHELL_LINE = /^(?:PS [^>]*>|[A-Za-z]:\\[^>]*>|\S+@\S+[^$#%]*[$#%]|[$#])\s*$/

export function isShellScreen(lines: readonly string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (line) return SHELL_LINE.test(line)
  }
  return false
}

const PROMPT_LINE = /^[\s│┃|]*[>❯›]\s*(.*?)[\s│┃|]*$/

/** Whether the command sits typed on a prompt line (`│ > /usage │`, `❯ /usage`). */
function commandOnPrompt(lines: readonly string[], command: string): boolean {
  return lines.some((line) => PROMPT_LINE.exec(line)?.[1] === command)
}

/** What the probe needs from a terminal, pane or hidden. */
export interface DriveIO {
  send(sessionId: string, data: string): void
  /** The terminal's rendered bottom page; null when it is gone. */
  screen(sessionId: string): string[] | null
  now(): number
  sleep(ms: number): Promise<void>
}

/** The terminal's output since the probe began watching, and when it last changed. */
export interface OutputWatch {
  text: string
  lastAt: number
}

/** Resolves once no output has arrived for `quietMs`, or after `maxMs`. */
export async function waitForQuiet(io: DriveIO, watch: OutputWatch, quietMs: number, maxMs: number): Promise<void> {
  const start = io.now()
  while (io.now() - start < maxMs) {
    if (io.now() - watch.lastAt >= quietMs) return
    await io.sleep(100)
  }
}

/**
 * Pick the dialog's Yes option: its digit, or arrow keys to it and Enter once the cursor is seen on
 * it. False when no Yes option is found or the cursor did not get there — Enter is never pressed on
 * anything else, since the option under the cursor may be "No, exit".
 */
async function answerTrust(io: DriveIO, sessionId: string, watch: OutputWatch, screen: string[]): Promise<boolean> {
  const plan = planTrustAnswer(screen)
  if (!plan) return false
  if (plan.kind === 'number') {
    io.send(sessionId, `${plan.key}\r`)
    return true
  }
  if (plan.moves !== 0) {
    const key = plan.moves > 0 ? ARROW.down : ARROW.up
    for (let step = 0; step < Math.abs(plan.moves); step += 1) {
      io.send(sessionId, key)
      await io.sleep(ARROW_DELAY_MS)
    }
    await waitForQuiet(io, watch, QUIET_MS, MAX_SETTLE_MS)
    const moved = planTrustAnswer(io.screen(sessionId) ?? [])
    if (moved?.kind !== 'arrows' || moved.moves !== 0) return false
  }
  io.send(sessionId, '\r')
  return true
}

/**
 * Let the agent finish drawing, then answer a folder/environment trust dialog with Yes so it
 * reaches its prompt. Returns the screen it ended on — still the dialog if it could not be answered.
 */
export async function settleAndTrust(io: DriveIO, sessionId: string, watch: OutputWatch): Promise<string[]> {
  await waitForQuiet(io, watch, QUIET_MS, MAX_SETTLE_MS)
  let screen = io.screen(sessionId) ?? []
  for (let answers = 0; answers < MAX_TRUST_ANSWERS && isTrustScreen(screen); answers += 1) {
    if (!(await answerTrust(io, sessionId, watch, screen))) break
    await io.sleep(SUBMIT_DELAY_MS)
    await waitForQuiet(io, watch, QUIET_MS, MAX_SETTLE_MS)
    screen = io.screen(sessionId) ?? []
  }
  return screen
}

/**
 * Parse the reply from what the command added to the screen: lines already there before it was
 * typed (a resumed transcript, an old panel) are left out, so nothing stale is read as the answer.
 */
function readReply(
  probe: AgentProbe,
  screen: string[] | null,
  before: ReadonlySet<string>,
  beforeText: string,
  stream: string,
  now: number,
): UsageParse | null {
  const currentLines = screen ?? []
  const currentText = currentLines.join('\n')

  const fresh = currentLines.filter((line) => line.trim() !== '' && !before.has(line)).join('\n')
  const fromScreen = fresh ? probe.parse(fresh, now) : null
  if (fromScreen?.ok) return fromScreen

  if (currentText !== beforeText && currentLines.length > 0) {
    let lastCmdIdx = -1
    for (let i = currentLines.length - 1; i >= 0; i -= 1) {
      if (currentLines[i].includes(probe.command)) {
        lastCmdIdx = i
        break
      }
    }
    if (lastCmdIdx !== -1 && lastCmdIdx < currentLines.length - 1) {
      const fromAfterCmd = probe.parse(currentLines.slice(lastCmdIdx + 1).join('\n'), now)
      if (fromAfterCmd.ok) return fromAfterCmd
    }
    const fromFull = probe.parse(currentText, now)
    if (fromFull.ok) return fromFull
  }

  if (!probe.stream || !stream) return fromScreen
  const fromStream = probe.parse(stream, now)
  return fromStream.ok || fromStream.error === 'not_signed_in' ? fromStream : fromScreen
}

/** Until the typed command shows on the prompt; a lagging app may not have drawn it yet. */
async function waitForEcho(probe: AgentProbe, io: DriveIO, sessionId: string): Promise<void> {
  const start = io.now()
  while (io.now() - start < ECHO_WAIT_MS) {
    if (commandOnPrompt(io.screen(sessionId) ?? [], probe.command)) return
    await io.sleep(100)
  }
}

/**
 * Type the agent's quota command, wait for its panel and parse it; the panel is closed again
 * whatever the outcome. Null when no reply parsed in time, or when the screen is not the agent's
 * prompt (its shell is back, or a trust dialog is still up) — nothing is typed then.
 */
export async function submitAndRead(
  probe: AgentProbe,
  io: DriveIO,
  sessionId: string,
  watch: OutputWatch,
): Promise<UsageParse | null> {
  const beforeScreen = io.screen(sessionId) ?? []
  if (isShellScreen(beforeScreen) || isTrustScreen(beforeScreen)) return null
  const before = new Set(beforeScreen)
  const beforeText = beforeScreen.join('\n')
  watch.text = ''
  try {
    io.send(sessionId, probe.command)
    await waitForEcho(probe, io, sessionId)
    await io.sleep(SUBMIT_DELAY_MS)
    io.send(sessionId, '\r')
    const started = io.now()
    let lastEnter = started
    let outputAtEnter = watch.text.length
    let retries = 0
    while (io.now() - lastEnter < REPLY_TIMEOUT_MS && io.now() - started < MAX_REPLY_MS) {
      const screen = io.screen(sessionId)
      const parsed = readReply(probe, screen, before, beforeText, watch.text, io.now())
      if (parsed?.ok || parsed?.error === 'not_signed_in') return parsed
      if (retries < MAX_ENTER_RETRIES && io.now() - lastEnter >= RETRY_ENTER_MS) {
        // The Enter was dropped, or landed inside a paste burst: the command is still on the prompt.
        if (commandOnPrompt(screen ?? [], probe.command) || watch.text.length === outputAtEnter) {
          io.send(sessionId, '\r')
          retries += 1
          lastEnter = io.now()
          outputAtEnter = watch.text.length
        }
      }
      await io.sleep(150)
    }
    return null
  } finally {
    if (probe.close) {
      io.send(sessionId, probe.close)
      await io.sleep(CLOSE_DELAY_MS)
    }
  }
}

/**
 * Quota from a usage panel already on screen (the user typed the command): read from the last line
 * holding the command, or else the whole screen.
 */
export function readUsageScreen(agent: AgentKind, lines: readonly string[], now: number): QuotaSnapshot | null {
  const probe = AGENT_PROBES[agent]
  const commandIndices: number[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(probe.command)) {
      commandIndices.push(i)
    }
  }

  for (const idx of commandIndices) {
    const candidates = [lines.slice(idx + 1), lines.slice(idx)]
    for (const candidate of candidates) {
      if (candidate.length === 0) continue
      const parsed = probe.parse(candidate.join('\n'), now)
      if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }
    }
  }

  for (const candidate of [lines.slice(-60), lines]) {
    if (candidate.length === 0) continue
    const parsed = probe.parse(candidate.join('\n'), now)
    if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }
  }

  return null
}
