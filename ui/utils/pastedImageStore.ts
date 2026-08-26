/**
 * Per-pane memory slot for the last image pasted into a terminal session.
 *
 * Both image-paste paths (the native paste-event gate and the Ctrl+V clipboard reader) already
 * hold the image bytes while persisting the temp PNG the agent attaches by path; this store
 * keeps a blob URL for those bytes so the pane header can offer a native, full-resolution
 * preview — TUI agents render the same image as unreadable cell-block art.
 *
 * One slot per session id, replaced on every paste. Pure module, no React imports: snapshots
 * are stable references shaped for `useSyncExternalStore`, and every entry point treats a null
 * session id (empty pane) as a no-op. Nothing here may ever throw into a paste flow.
 */

export interface PastedImage {
  /** Blob URL for the pasted bytes; revoked on replace and release. */
  objectUrl: string
  /** Absolute temp-PNG path that was inserted into the PTY. */
  path: string
}

/** Bytes + path captured by the clipboard layer at the moment of a paste. */
export interface SavedPastedImage {
  bytes: Uint8Array
  path: string
}

type Listener = () => void

const slots = new Map<string, PastedImage>()
const slotListeners = new Map<string, Set<Listener>>()
const openListeners = new Map<string, Set<Listener>>()

const notify = (listeners: Map<string, Set<Listener>>, sessionId: string): void => {
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

const addListener = (listeners: Map<string, Set<Listener>>, sessionId: string, listener: Listener): (() => void) => {
  let set = listeners.get(sessionId)
  if (!set) {
    set = new Set()
    listeners.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/**
 * Record a pasted image for `sessionId`, replacing (and revoking) any previous one. The old URL
 * is revoked only after the new one exists, so a viewer showing the slot never renders a dead
 * URL. Fire-and-forget from the paste path's perspective: malformed payloads and environments
 * without object URLs are swallowed — path insertion into the PTY must never be affected.
 */
export const setLastPastedImage = (sessionId: string | null, saved: SavedPastedImage): void => {
  if (!sessionId || saved.bytes.length === 0) return
  let objectUrl: string
  try {
    // `new Uint8Array(saved.bytes)` normalizes the view to a plain ArrayBuffer-backed copy —
    // TS 5.7's BlobPart rejects ArrayBufferLike views that may wrap a SharedArrayBuffer.
    objectUrl = URL.createObjectURL(new Blob([new Uint8Array(saved.bytes)]))
  } catch {
    return
  }
  const previous = slots.get(sessionId)
  if (previous) URL.revokeObjectURL(previous.objectUrl)
  slots.set(sessionId, { objectUrl, path: saved.path })
  notify(slotListeners, sessionId)
}

export const getLastPastedImage = (sessionId: string | null): PastedImage | null =>
  sessionId ? slots.get(sessionId) ?? null : null

/** Drop the slot and revoke its URL (pane unmount / session close). */
export const releasePastedImage = (sessionId: string | null): void => {
  if (!sessionId) return
  const previous = slots.get(sessionId)
  if (!previous) return
  URL.revokeObjectURL(previous.objectUrl)
  slots.delete(sessionId)
  notify(slotListeners, sessionId)
}

export const subscribePastedImage = (sessionId: string | null, listener: Listener): (() => void) =>
  sessionId ? addListener(slotListeners, sessionId, listener) : () => {}

/** Button-to-viewer signal: the pane header asks TerminalView's viewer host to open. */
export const requestOpen = (sessionId: string | null): void => {
  if (sessionId) notify(openListeners, sessionId)
}

export const subscribeOpen = (sessionId: string | null, listener: Listener): (() => void) =>
  sessionId ? addListener(openListeners, sessionId, listener) : () => {}
