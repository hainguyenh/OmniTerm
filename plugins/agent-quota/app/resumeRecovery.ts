import type { ResumeRecoveryConfig } from './quotaConfig'

import { readPaneScreen } from '../../../ui/utils/paneScreens'
import { lastUserInputAt } from '../../../ui/utils/paneInputHold'
import { pushNotice } from './quotaStore'

/**
 * Patterns matching Claude Code's interruption error when suspended mid-stream:
 * "API Error: The response stopped arriving. The response above may be incomplete."
 */
export const RESUME_ERROR_PATTERNS: readonly RegExp[] = [
  /API Error: The response stopped arriving/i,
  /The response above may be incomplete/i,
]

/**
 * Checks whether the terminal screen shows the Claude interrupted response error.
 * Lines are concatenated to handle text wrapping across terminal columns.
 */
export function hasResumeError(screenLines: readonly string[]): boolean {
  if (screenLines.length === 0) return false
  const combined = screenLines.join(' ')
  return RESUME_ERROR_PATTERNS.some((pattern) => pattern.test(combined))
}

export interface ResumeRecoveryIO {
  send(sessionId: string, data: string): void
  readScreen(sessionId: string): string[] | null
  lastUserInputAt(sessionId: string): number | undefined
  now(): number
  setTimer(action: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
  pushNotice?(level: 'info' | 'warning' | 'danger', message: string): void
}

export const LIVE_RECOVERY_IO: ResumeRecoveryIO = {
  send: (sessionId, data) => { void window.omnitermAPI?.connect?.localInput?.(sessionId, data) },
  readScreen: readPaneScreen,
  lastUserInputAt,
  now: () => Date.now(),
  setTimer: (action, ms) => setTimeout(action, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  pushNotice,
}

interface PendingRecovery {
  timer: unknown
  resumedAt: number
}

const pendingRecoveries = new Map<string, PendingRecovery>()

/**
 * Checks if a resume recovery timer is currently active for the given session.
 */
export function isResumeRecoveryPending(sessionId: string): boolean {
  return pendingRecoveries.has(sessionId)
}

/**
 * Cancels any scheduled resume recovery check for the given session.
 */
export function cancelResumeRecovery(sessionId: string, io: ResumeRecoveryIO = LIVE_RECOVERY_IO): void {
  const pending = pendingRecoveries.get(sessionId)
  if (!pending) return
  io.clearTimer(pending.timer)
  pendingRecoveries.delete(sessionId)
}

/**
 * Clears all pending resume recovery checks across all sessions (used on unmount / reset).
 */
export function clearAllResumeRecovery(io: ResumeRecoveryIO = LIVE_RECOVERY_IO): void {
  for (const [, pending] of pendingRecoveries) {
    io.clearTimer(pending.timer)
  }
  pendingRecoveries.clear()
}

/**
 * Schedules a single check after resume to detect if Claude failed with an interrupted response error.
 * If detected and the user has not typed into the terminal since resume, sends the configured prompt
 * (e.g. 'continue' or 'tiếp tục') followed by Enter.
 */
export function scheduleResumeRecovery(
  sessionId: string,
  config: ResumeRecoveryConfig,
  io: ResumeRecoveryIO = LIVE_RECOVERY_IO,
): void {
  if (!config.enabled || !config.prompt.trim()) return

  cancelResumeRecovery(sessionId, io)

  const resumedAt = io.now()
  const delayMs = Math.max(1, config.delaySeconds) * 1_000

  const timer = io.setTimer(() => {
    pendingRecoveries.delete(sessionId)

    // Safety guard: if the user typed anything since resume, do not interfere.
    const userTypedAt = io.lastUserInputAt(sessionId)
    if (userTypedAt !== undefined && userTypedAt >= resumedAt) return

    const lines = io.readScreen(sessionId)
    if (!lines || !hasResumeError(lines)) return

    const promptText = config.prompt.trim()
    io.send(sessionId, `${promptText}\r`)
    io.pushNotice?.('info', `Claude response was interrupted during suspend. Sent "${promptText}".`)
  }, delayMs)

  pendingRecoveries.set(sessionId, { timer, resumedAt })
}
