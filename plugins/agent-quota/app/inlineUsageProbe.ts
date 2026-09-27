/**
 * Inline `/usage` at an agent's first launch.
 *
 * `claude -p /usage` sometimes answers with only the "What's contributing to your limits usage?"
 * report and no limit numbers, so a freshly opened agent could show no quota for a while. When a
 * profile's agent is first seen, just started and not yet typed into, OmniTerm asks it directly:
 * input is held, `/usage` is typed into the agent, the panel it draws is parsed from the pane's
 * output, the panel is closed (Esc), and input is released with anything typed meanwhile. If any
 * step fails the engine falls back to the background `-p /usage` read.
 */
import { useSyncExternalStore } from 'react'

import type { QuotaSnapshot } from '../src/types'
import type { TerminalAgent } from './quotaStore'

import { parseClaudeUsage } from '../src/claudeUsageParser'
import { tapSessionOutput } from '../../../ui/tauriSessions'
import { holdPaneInput, lastUserInputAt } from '../../../ui/utils/paneInputHold'

/** Only an agent this young is still at its empty prompt; an older one may be mid-task. */
export const PROBE_MAX_AGE_S = 30
const QUIET_MS = 700
const MAX_SETTLE_MS = 6_000
const REPLY_TIMEOUT_MS = 8_000
const SUBMIT_DELAY_MS = 120
const CLOSE_DELAY_MS = 150

export interface ProbeIO {
  send(sessionId: string, data: string): void
  tap(sessionId: string, onOutput: (text: string) => void): () => void
  hold(sessionId: string): () => string
  lastUserInputAt(sessionId: string): number | undefined
  now(): number
  sleep(ms: number): Promise<void>
}

const probing = new Set<string>()
const listeners = new Set<() => void>()

function setProbing(sessionId: string, on: boolean): void {
  if (on) probing.add(sessionId)
  else probing.delete(sessionId)
  for (const listener of listeners) listener()
}

/** True while the probe owns this pane — the pane shows a "Reading quota…" hint. */
export function useUsageProbe(sessionId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => probing.has(sessionId),
    () => false,
  )
}

/** Whether this terminal's agent is fresh enough, and untouched, for an inline probe. */
export function canProbeInline(terminal: TerminalAgent, io: Pick<ProbeIO, 'lastUserInputAt' | 'now'>): boolean {
  if (terminal.agent !== 'claude') return false
  const startedMs = terminal.startTime * 1000
  if (io.now() - startedMs > PROBE_MAX_AGE_S * 1000) return false
  const typed = io.lastUserInputAt(terminal.sessionId)
  return typed === undefined || typed < startedMs
}

/** Resolves once no output has arrived for `quietMs`, or after `maxMs`. */
async function waitForQuiet(io: ProbeIO, changedAt: () => number, quietMs: number, maxMs: number): Promise<void> {
  const start = io.now()
  while (io.now() - start < maxMs) {
    if (io.now() - changedAt() >= quietMs) return
    await io.sleep(100)
  }
}

export async function probeUsageInline(terminal: TerminalAgent, io: ProbeIO): Promise<QuotaSnapshot | null> {
  if (!canProbeInline(terminal, io)) return null
  const { sessionId } = terminal
  const release = io.hold(sessionId)
  setProbing(sessionId, true)
  let output = ''
  let lastOutputAt = io.now()
  const untap = io.tap(sessionId, (text) => {
    output += text
    lastOutputAt = io.now()
  })
  try {
    // Let the agent finish drawing its first screen before typing into it.
    await waitForQuiet(io, () => lastOutputAt, QUIET_MS, MAX_SETTLE_MS)
    output = ''
    io.send(sessionId, '/usage')
    await io.sleep(SUBMIT_DELAY_MS)
    io.send(sessionId, '\r')
    const started = io.now()
    while (io.now() - started < REPLY_TIMEOUT_MS) {
      const parsed = parseClaudeUsage(output, io.now())
      if (parsed.ok) return { windows: parsed.windows, fetchedAt: io.now(), source: 'cli' }
      if (parsed.error === 'not_signed_in') return null
      await io.sleep(150)
    }
    return null
  } finally {
    untap()
    // Close the usage panel whether or not it parsed, then give the agent back its keyboard.
    io.send(sessionId, '\x1b')
    await io.sleep(CLOSE_DELAY_MS)
    const typed = release()
    if (typed) io.send(sessionId, typed)
    setProbing(sessionId, false)
  }
}

/** The real pane I/O: the session's input channel, an output tap, and the pane input hold. */
export const LIVE_PROBE_IO: ProbeIO = {
  send: (sessionId, data) => { void window.omnitermAPI?.connect?.localInput?.(sessionId, data) },
  tap: (sessionId, onOutput) => {
    // One decoder per tap: a multi-byte character split across chunks must not leak between panes.
    const decoder = new TextDecoder()
    return tapSessionOutput(sessionId, (bytes) => onOutput(decoder.decode(bytes, { stream: true })))
  },
  hold: holdPaneInput,
  lastUserInputAt,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
