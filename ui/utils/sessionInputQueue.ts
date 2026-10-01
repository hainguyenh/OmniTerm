/**
 * Keystrokes reach a pane's PTY in the order they were typed.
 *
 * Each `send_session_input` is its own async command, and the backend forwards each one over a
 * fresh connection to the session daemon, which handles every connection in its own task (and a
 * busy Windows pipe makes a connect wait and retry). Sent back to back, two chunks could therefore
 * be written to the PTY in either order, and a Telex correction (Backspace, then the corrected
 * letter) arriving out of order left doubled, missing or jumbled characters — worst in agent TUIs
 * and in the release build, where fast typing and a busy agent make the race likely.
 *
 * So a pane's next chunk is only sent once the previous one was written (the daemon answers after
 * writing). Chunks are never merged or split: the program sees exactly what xterm produced, as a
 * shell always has. A send that never answers stops holding the rest back after a while.
 */

/** Longest a pane's input waits on one earlier chunk the backend has not answered. */
const STALL_MS = 2_000

const tails = new Map<string, Promise<void>>()

function afterOrStalled(previous: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<void>((resolve) => { timer = setTimeout(resolve, STALL_MS) })
  return Promise.race([previous, stalled]).finally(() => clearTimeout(timer))
}

export function sendInOrder(sessionId: string, send: () => Promise<unknown>): Promise<void> {
  const previous = tails.get(sessionId)
  const next = (previous ? afterOrStalled(previous) : Promise.resolve()).then(send).then(() => {}, () => {})
  tails.set(sessionId, next)
  void next.then(() => {
    if (tails.get(sessionId) === next) tails.delete(sessionId)
  })
  return next
}
