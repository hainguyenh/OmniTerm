/**
 * Tells the backend how much of a session's output this window has written to its terminal.
 *
 * The backend stops reading a session once 8 MiB it sent is still unacknowledged (see
 * src-tauri/src/pty_flow.rs), so a busy or throttled window can no longer make the app's memory grow
 * without limit. Acknowledgements are batched per session: one IPC call per written chunk would cost
 * more than the output it reports.
 */

import { invoke } from '@tauri-apps/api/core'

/** Sent at once past this many bytes; far below the backend's 4 MiB resume mark. */
const ACK_BATCH_BYTES = 256 * 1024
/** Otherwise sent this long after the first unreported byte. */
const ACK_DELAY_MS = 50

const pending = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null

function send(id: string, bytes: number): void {
  void invoke('ack_session_output', { id, bytes }).catch(() => {})
}

function flushAll(): void {
  timer = null
  for (const [id, bytes] of pending) send(id, bytes)
  pending.clear()
}

export function ackSessionOutput(id: string, bytes: number): void {
  if (!(bytes > 0)) return
  const total = (pending.get(id) ?? 0) + bytes
  if (total >= ACK_BATCH_BYTES) {
    pending.delete(id)
    send(id, total)
    return
  }
  pending.set(id, total)
  timer ??= setTimeout(flushAll, ACK_DELAY_MS)
}

/** Exported for tests: forget unreported bytes and the pending timer. */
export function __resetOutputAckForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending.clear()
}
