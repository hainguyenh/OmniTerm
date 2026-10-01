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
 * The freeze starts as soon as an agent command is submitted in the pane (or a restored pane is
 * started with one), before the process even shows up: a launch hold keeps the keyboard until the
 * probe takes the pane over, so the user cannot type into the agent's first screen (a folder-trust
 * dialog the probe answers, or the prompt it is about to type into).
 *
 * A resume picker or a first-run login needs the user, and typing into it would pick for them: the
 * probe hands the keyboard back at once, waits for it to close, and asks only if nothing was typed
 * after that.
 */
import { useSyncExternalStore } from 'react'

import type { QuotaSnapshot } from '../src/types'
import type { TerminalAgent } from './quotaStore'
import type { DriveIO, OutputWatch } from './usageProbeCore'

import { tapSessionOutput } from '../../../ui/tauriSessions'
import { holdPaneInput, lastUserInputAt } from '../../../ui/utils/paneInputHold'
import { readPaneScreen } from '../../../ui/utils/paneScreens'
import { AGENT_PROBES, isBlockingScreen, MAX_SETTLE_MS, QUIET_MS, settleAndTrust, submitAndRead, waitForQuiet } from './usageProbeCore'

export { isBlockingScreen, isTrustScreen } from './usageProbeCore'

/** Only an agent this young is still at its empty prompt (or its resume picker). */
export const PROBE_MAX_AGE_S = 30
/**
 * Process start times are whole seconds, and the Enter that launched the agent lands in that same
 * second (earlier still behind a launcher script) — so only input after this counts as typing into
 * the agent. Comparing against the bare start second declined nearly every launch.
 */
const LAUNCH_GRACE_MS = 1_500
/** How long a picker or dialog may stay up before the probe gives up and the background read runs. */
const MAX_DIALOG_WAIT_MS = 10_000
const DIALOG_POLL_MS = 250
/** Safety net: a launch hold nobody took over (the engine stopped) lets go of the pane by itself. */
const LAUNCH_HOLD_MAX_MS = 25_000

export interface ProbeIO extends DriveIO {
  tap(sessionId: string, onOutput: (text: string) => void): () => void
  hold(sessionId: string): () => string
  lastUserInputAt(sessionId: string): number | undefined
}

/** Why a pane is veiled: an agent is starting under a launch hold, or its quota is being read. */
export type ProbeVeil = { phase: 'starting' } | { phase: 'reading'; command: string }

const STARTING: ProbeVeil = { phase: 'starting' }
const veils = new Map<string, ProbeVeil>()
const listeners = new Set<() => void>()

function setVeil(sessionId: string, veil: ProbeVeil | null): void {
  if (veil) veils.set(sessionId, veil)
  else veils.delete(sessionId)
  for (const listener of listeners) listener()
}

/** What veils this pane right now, or null — the pane's input is held while it is set. */
export function useUsageProbe(sessionId: string): ProbeVeil | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => veils.get(sessionId) ?? null,
    () => null,
  )
}

interface LaunchHold {
  release: () => string
  timer: ReturnType<typeof setTimeout>
}

const launchHolds = new Map<string, LaunchHold>()

/** Hand back the pane: the veil lifts and whatever was typed meanwhile reaches it, in order. */
function giveBack(io: Pick<ProbeIO, 'send'>, sessionId: string, release: () => string): void {
  const typed = release()
  setVeil(sessionId, null)
  if (typed) io.send(sessionId, typed)
}

function takeLaunchHold(sessionId: string): (() => string) | null {
  const hold = launchHolds.get(sessionId)
  if (!hold) return null
  clearTimeout(hold.timer)
  launchHolds.delete(sessionId)
  return hold.release
}

/** Freeze a pane an agent is being started in, until the probe takes it over or it is released. */
export function holdForLaunch(sessionId: string, io: Pick<ProbeIO, 'hold' | 'send'> = LIVE_PROBE_IO): void {
  if (launchHolds.has(sessionId) || veils.has(sessionId)) return
  const release = io.hold(sessionId)
  const timer = setTimeout(() => releaseLaunchHold(sessionId, io), LAUNCH_HOLD_MAX_MS)
  launchHolds.set(sessionId, { release, timer })
  setVeil(sessionId, STARTING)
}

/** Let go of a launch hold no probe is going to take over. */
export function releaseLaunchHold(sessionId: string, io: Pick<ProbeIO, 'send'> = LIVE_PROBE_IO): void {
  const release = takeLaunchHold(sessionId)
  if (release) giveBack(io, sessionId, release)
}

export function hasLaunchHold(sessionId: string): boolean {
  return launchHolds.has(sessionId)
}

export function isProbingUsage(sessionId: string): boolean {
  return launchHolds.has(sessionId) || veils.has(sessionId)
}

/**
 * Whether this terminal's agent is fresh enough, and untouched, for an inline probe. A pane held
 * since the launch cannot have been typed into, so only the age counts then.
 */
export function canProbeInline(
  terminal: TerminalAgent,
  io: Pick<ProbeIO, 'lastUserInputAt' | 'now'>,
  heldSinceLaunch = false,
): boolean {
  if (!Object.hasOwn(AGENT_PROBES, terminal.agent)) return false
  const startedMs = terminal.startTime * 1000
  if (io.now() - startedMs > PROBE_MAX_AGE_S * 1000) return false
  if (heldSinceLaunch) return true
  const typed = io.lastUserInputAt(terminal.sessionId)
  return typed === undefined || typed < startedMs + LAUNCH_GRACE_MS
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

export async function probeUsageInline(terminal: TerminalAgent, io: ProbeIO): Promise<QuotaSnapshot | null> {
  const { sessionId } = terminal
  const adopted = takeLaunchHold(sessionId)
  if (!canProbeInline(terminal, io, adopted !== null) || !io.screen(sessionId)) {
    if (adopted) giveBack(io, sessionId, adopted)
    return null
  }
  const probe = AGENT_PROBES[terminal.agent]
  const reading: ProbeVeil = { phase: 'reading', command: probe.command }
  const watch: OutputWatch = { text: '', lastAt: io.now() }
  const untap = io.tap(sessionId, (text) => {
    watch.text += text
    watch.lastAt = io.now()
  })
  const freeze = (release: () => string = io.hold(sessionId)) => {
    setVeil(sessionId, reading)
    return () => giveBack(io, sessionId, release)
  }
  let unfreeze: (() => void) | null = freeze(adopted ?? undefined)
  try {
    const screen = await settleAndTrust(io, sessionId, watch)
    if (isBlockingScreen(screen)) {
      unfreeze()
      unfreeze = null
      const clearedAt = await waitForUnblocked(io, sessionId)
      const typed = io.lastUserInputAt(sessionId)
      // Keys typed after the picker closed went to the agent's prompt: the user has taken over.
      if (clearedAt === null || (typed !== undefined && typed > clearedAt)) return null
      unfreeze = freeze()
      await waitForQuiet(io, watch, QUIET_MS, MAX_SETTLE_MS)
      if (isBlockingScreen(io.screen(sessionId) ?? [])) return null
    }
    const parsed = await submitAndRead(probe, io, sessionId, watch)
    return parsed?.ok ? { windows: parsed.windows, fetchedAt: io.now(), source: 'cli' } : null
  } finally {
    untap()
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
