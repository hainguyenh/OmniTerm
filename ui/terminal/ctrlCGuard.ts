import { ctrlCSettings } from './ctrlCSettings'

/**
 * Tracks Ctrl+C presses per session so one press interrupts the foreground process and two quick
 * presses close the session. State is module-level because the key handler and the exit handler
 * live in different components but must agree on what the user just did. The windows come from the
 * Ctrl+C settings (Settings › Tools › Terminal).
 */

export type CtrlCDecision = 'interrupt' | 'kill'

const lastPress = new Map<string, number>()

export function onCtrlC(id: string, now: number): CtrlCDecision {
  const { doublePress, windowMs } = ctrlCSettings()
  const previous = lastPress.get(id)
  if (doublePress === 'close' && previous !== undefined && now - previous <= windowMs) {
    lastPress.delete(id)
    return 'kill'
  }
  lastPress.set(id, now)
  return 'interrupt'
}

/** True when the last Ctrl+C was recent enough that a process exit is probably its result. */
export function recentlyInterrupted(id: string, now: number, windowMs = ctrlCSettings().keepTabSeconds * 1000): boolean {
  const previous = lastPress.get(id)
  return previous !== undefined && now - previous <= windowMs
}

export function forgetCtrlC(id: string): void {
  lastPress.delete(id)
}
