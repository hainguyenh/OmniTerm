/**
 * The pane strip's "read quota" button. It types nothing: it reads the usage panel already on the
 * pane's screen. With no panel there, the pane is marked as awaiting one and the user is asked to
 * open it themselves (`/usage`; `/status` for Codex); every engine tick then reads the screen
 * again, and the first panel that parses is recorded into the profile.
 *
 * The click-time read of the whole screen found nothing, so any panel that parses later was drawn
 * since — no old reading is taken for a fresh one.
 */
import type { QuotaSnapshot } from '../src/types'
import type { TerminalAgent } from './quotaStore'

import { AGENT_LABELS } from './quotaConfig'
import { getQuotaState, pushNotice, updateQuota } from './quotaStore'
import { readUsageScreen } from './usageProbeCore'

/** How long a pane waits for the user's panel before the request lapses. */
export const AWAIT_USAGE_MS = 120_000

export interface ManualReadDeps {
  /** The pane's rendered bottom page; null when it is not on screen. */
  readScreen(sessionId: string): string[] | null
  now(): number
  record(profileKey: string, snapshot: QuotaSnapshot): void
}

const nameOf = (terminal: TerminalAgent) => `${AGENT_LABELS[terminal.agent]} (${terminal.profileName})`

export function cancelUsageRead(sessionId: string): void {
  updateQuota((state) => {
    if (!(sessionId in state.awaitingUsage)) return state
    const awaitingUsage = { ...state.awaitingUsage }
    delete awaitingUsage[sessionId]
    return { ...state, awaitingUsage }
  })
}

function tryRead(deps: ManualReadDeps, terminal: TerminalAgent): boolean {
  const screen = deps.readScreen(terminal.sessionId)
  const snapshot = screen ? readUsageScreen(terminal.agent, screen, deps.now()) : null
  if (!snapshot) return false
  cancelUsageRead(terminal.sessionId)
  deps.record(terminal.profileKey, snapshot)
  pushNotice('info', `Quota updated for ${nameOf(terminal)} from its usage panel.`)
  return true
}

export function readUsageNow(deps: ManualReadDeps, sessionId: string): void {
  const state = getQuotaState()
  const terminal = state.terminals[sessionId] ?? Object.values(state.terminals).find((t) => t.sessionId === sessionId)
  if (!terminal) {
    pushNotice('warning', 'No active monitored agent process found for this terminal.')
    return
  }
  if (tryRead(deps, terminal)) return
  const now = deps.now()
  updateQuota((s) => ({ ...s, awaitingUsage: { ...s.awaitingUsage, [sessionId]: now } }))
}

/** Each engine tick: look again at every pane waiting for its panel. */
export function pollUsageReads(deps: ManualReadDeps): void {
  const { awaitingUsage, terminals } = getQuotaState()
  for (const [sessionId, since] of Object.entries(awaitingUsage)) {
    const terminal = terminals[sessionId]
    if (!terminal) {
      cancelUsageRead(sessionId)
      continue
    }
    if (tryRead(deps, terminal)) continue
    if (deps.now() - since >= AWAIT_USAGE_MS) {
      cancelUsageRead(sessionId)
      pushNotice('warning', `No usage panel appeared for ${nameOf(terminal)}; its quota was not updated.`)
    }
  }
}
