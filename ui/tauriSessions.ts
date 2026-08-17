/**
 * tauriSessions.ts — local terminal streaming over Tauri IPC channels
 *
 * A pane's output and its ready/error/closed status arrive on two `Channel`s created here and handed
 * to `start_local_session`, instead of on global events named after the session id. That replaces the
 * 1:1 port of Electron's event bus, which had three problems:
 *
 *   * A session id may contain any character (`<connId>_<uuid>` for LOCAL panes), but Tauri event
 *     names are restricted to `[A-Za-z0-9-/:_]`. An id outside that set made every `listen`/`emit`
 *     fail, and the pane sat on "connecting" forever with the shell running invisibly behind it.
 *   * `listen()` only registers after an async IPC round-trip, so anything the backend emitted in
 *     that window was dropped with no error anywhere. Avoiding that needed a "wait for listeners to
 *     settle" step before every connect, with a timeout that could stall a launch for seconds.
 *   * A global event is delivered to every listener in the webview: any script running there could
 *     read another pane's bytes, or `emit` a forged `session-error-<id>`.
 *
 * Handlers here are registered synchronously in a local map before `invoke` is called, so there is no
 * window to lose output in and nothing for another script to subscribe to.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { diag } from './diag'

/** Status messages from the backend's `SessionStatus` enum (serde tag = "kind"). */
type SessionStatus =
  | { kind: 'ready'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'closed'; code: number }
  | { kind: 'activity'; busy: boolean }

type SessionHandlers = {
  ready: (label?: string) => void
  data: (bytes: Uint8Array) => void
  error: (message: string) => void
  closed: (code: number) => void
  /** The shell started/stopped running something. Sent on change only, so it is a plain flag. */
  activity: (busy: boolean) => void
}

export type SessionEventKind = keyof SessionHandlers

/**
 * Live panes, keyed by session id. An entry exists only while something is subscribed to it: each
 * `onSession` call removes its own handler, and the entry goes when the last one does — so a long
 * session-heavy run cannot leave the map growing.
 */
const handlers = new Map<string, Partial<SessionHandlers>>()

/**
 * Subscribe to one kind of message for one session. Returns a synchronous unsubscribe, because every
 * caller is a React effect that has to return its cleanup immediately.
 */
export function onSession<K extends SessionEventKind>(
  id: string,
  kind: K,
  callback: SessionHandlers[K],
): () => void {
  const entry = handlers.get(id) ?? {}
  entry[kind] = callback
  handlers.set(id, entry)
  return () => {
    const current = handlers.get(id)
    // Identity check: a remount registers a new handler under the same key, and the old effect's
    // cleanup must not delete the new one.
    if (!current || current[kind] !== callback) return
    delete current[kind]
    if (Object.keys(current).length === 0) handlers.delete(id)
  }
}

/** Normalize a channel payload to bytes. Raw bodies arrive as an ArrayBuffer. */
function toBytes(message: ArrayBuffer | ArrayBufferView | number[]): Uint8Array {
  if (message instanceof ArrayBuffer) return new Uint8Array(message)
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
  }
  return new Uint8Array(message)
}

/**
 * Report a failed start on the session's own error handler, as the backend would.
 *
 * Exported because the SSH/RDP stubs report "not available in this build yet" the same way: the pane
 * shows a reason instead of sitting on "connecting".
 */
export function failSession(id: string, message: string): void {
  diag.error(`[omnitermAPI] ${id}: ${message}`)
  handlers.get(id)?.error?.(message)
}

/** Build the pair of channels a session streams over, routed to this module's handler map. */
function sessionChannels(id: string) {
  const onData = new Channel<ArrayBuffer | number[]>()
  onData.onmessage = (message) => handlers.get(id)?.data?.(toBytes(message))

  const onStatus = new Channel<SessionStatus>()
  onStatus.onmessage = (status) => {
    const entry = handlers.get(id)
    if (status.kind === 'ready') entry?.ready?.(status.label ?? undefined)
    else if (status.kind === 'error') entry?.error?.(status.message)
    else if (status.kind === 'closed') entry?.closed?.(status.code ?? 0)
    else if (status.kind === 'activity') entry?.activity?.(!!status.busy)
  }

  return { onData, onStatus }
}

/**
 * Start a local pane. The backend resolves `connId` (persisted tree or in-memory ad-hoc registry) and
 * validates the shell, so nothing about the launch is decided here.
 */
export async function startSession(
  id: string,
  connId: string,
  overrideShell?: string,
  darkMode?: boolean,
): Promise<void> {
  const { onData, onStatus } = sessionChannels(id)

  try {
    await invoke('start_local_session', {
      id,
      connId,
      shell: overrideShell ?? null,
      ...(darkMode === undefined ? {} : { darkMode }),
      onData,
      onStatus,
    })
    // No ready message is synthesized here: the backend sends one once the PTY is actually live.
  } catch (e) {
    failSession(id, String(e))
  }
}

/** What the backend knows about a session at the moment a window binds to it. */
export type AttachSnapshot = {
  status: 'ready' | 'error' | 'closed'
  label?: string
  error?: string
  busy: boolean
  generation: number
}

/**
 * Bind this window to an already-running session and replay its scrollback.
 *
 * The replay does NOT come back in the return value — it is pushed down the data channel created
 * here, as binary, before `attach_session` resolves. That keeps 256 KiB of scrollback off the JSON
 * path, and it lands on the same `onData` handler the caller already registered, so live output that
 * follows cannot overtake it.
 *
 * Returns null when the session is gone (the shell exited while the window was opening).
 */
export async function attachSession(id: string): Promise<AttachSnapshot | null> {
  const { onData, onStatus } = sessionChannels(id)
  try {
    return await invoke<AttachSnapshot | null>('attach_session', { id, onData, onStatus })
  } catch (e) {
    failSession(id, String(e))
    return null
  }
}

/** Exported for tests: drops all subscriptions so cases stay independent. */
export function __resetSessionsForTests(): void {
  handlers.clear()
}
