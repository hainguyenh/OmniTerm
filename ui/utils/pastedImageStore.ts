/**
 * Per-pane history of images pasted into a terminal session.
 *
 * Both image-paste paths (the native paste-event gate and the Ctrl+V clipboard reader) already
 * hold the image bytes while persisting the temp PNG the agent attaches by path; this store keeps
 * blob URLs for those bytes so the pane header can offer a native, full-resolution preview and the
 * viewer can flip back through earlier pastes — TUI agents render the same image as unreadable
 * cell-block art.
 *
 * One history per session id, appended on every paste and capped so long sessions cannot leak
 * blob URLs. Pure module, no React imports: snapshots are stable references shaped for
 * `useSyncExternalStore`, and every entry point treats a null session id (empty pane) as a no-op.
 * Nothing here may ever throw into a paste flow.
 */

export interface PastedImage {
  /** Blob URL for the pasted bytes; revoked on eviction and release. */
  objectUrl: string
  /** Absolute temp-PNG path that was inserted into the PTY. */
  path: string
}

/** Bytes + path captured by the clipboard layer at the moment of a paste. */
export interface SavedPastedImage {
  bytes: Uint8Array
  path: string
}

/** Oldest pastes are evicted (and their blob URLs revoked) once the history grows past this. */
export const MAX_PASTED_IMAGES = 12

type Listener = () => void

const slots = new Map<string, PastedImage[]>()
const slotListeners = new Map<string, Set<Listener>>()
const openListeners = new Map<string, Set<Listener>>()

// Stable empty snapshot: useSyncExternalStore requires getSnapshot to return the same reference
// between notifies, so a missing slot must not allocate a fresh array per call.
const EMPTY_HISTORY: PastedImage[] = []

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
 * Record a pasted image for `sessionId`, appending to the history and evicting (revoking) the
 * oldest once past the cap. Fire-and-forget from the paste path's perspective: malformed payloads
 * and environments without object URLs are swallowed — path insertion into the PTY must never be
 * affected.
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
  const history = [...slots.get(sessionId) ?? [], { objectUrl, path: saved.path }]
  while (history.length > MAX_PASTED_IMAGES) {
    const evicted = history.shift()
    if (evicted) URL.revokeObjectURL(evicted.objectUrl)
  }
  slots.set(sessionId, history)
  notify(slotListeners, sessionId)
}

/** Full paste history for `sessionId`, oldest first. The array reference is stable per notify. */
export const getPastedImages = (sessionId: string | null): PastedImage[] =>
  sessionId ? slots.get(sessionId) ?? EMPTY_HISTORY : EMPTY_HISTORY

export const getLastPastedImage = (sessionId: string | null): PastedImage | null => {
  const history = getPastedImages(sessionId)
  return history.length > 0 ? history[history.length - 1] : null
}

/** Drop the whole history and revoke its URLs (pane unmount / session close). */
export const releasePastedImage = (sessionId: string | null): void => {
  if (!sessionId) return
  const history = slots.get(sessionId)
  if (!history) return
  for (const image of history) URL.revokeObjectURL(image.objectUrl)
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
