/**
 * What each pane has attached this session: every image and file pasted or dropped into it, for the
 * footer's attachment list. The files themselves live in the app's attachment folder (and survive
 * the pane); this is only the per-pane index, dropped with the pane.
 *
 * Images also go to pastedImageStore, which holds their bytes as blob URLs for the full-size viewer
 * and the list's thumbnails. Pure module; snapshots are stable per notify for useSyncExternalStore.
 */
import type { AttachmentKind } from './attachmentTypes'
import type { SavedAttachment } from './attachmentInput'
import { releasePastedImage, setLastPastedImage, type SavedPastedImage } from './pastedImageStore'

export interface SessionAttachment {
  path: string
  name: string
  kind: AttachmentKind
  size: number
  /** When it was attached (epoch ms). */
  at: number
}

/** The oldest entries fall off the list past this; their files stay in the folder. */
export const MAX_SESSION_ATTACHMENTS = 50

type Listener = () => void

const lists = new Map<string, SessionAttachment[]>()
const listeners = new Map<string, Set<Listener>>()
const EMPTY: SessionAttachment[] = []

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

const notify = (sessionId: string): void => {
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

const record = (sessionId: string, entries: SessionAttachment[]): void => {
  if (entries.length === 0) return
  // One entry per path, at its latest position: a re-pasted file moves to the end.
  const byPath = new Map<string, SessionAttachment>()
  for (const entry of [...(lists.get(sessionId) ?? []), ...entries]) {
    byPath.delete(entry.path)
    byPath.set(entry.path, entry)
  }
  lists.set(sessionId, [...byPath.values()].slice(-MAX_SESSION_ATTACHMENTS))
  notify(sessionId)
}

/** A pasted clipboard image: into the image viewer's history and onto the attachment list. */
export const recordPastedImage = (sessionId: string | null, saved: SavedPastedImage, now = Date.now()): void => {
  if (!sessionId) return
  setLastPastedImage(sessionId, saved)
  record(sessionId, [{ path: saved.path, name: baseName(saved.path), kind: 'image', size: saved.bytes.length, at: now }])
}

/** Stored files from a paste or drop. Images that came with their bytes also reach the viewer. */
export const recordSavedAttachments = (sessionId: string | null, saved: readonly SavedAttachment[], now = Date.now()): void => {
  if (!sessionId) return
  for (const { info, bytes } of saved) {
    if (info.kind === 'image' && bytes) setLastPastedImage(sessionId, { bytes, path: info.path })
  }
  record(sessionId, saved.map(({ info }) => ({ path: info.path, name: info.name, kind: info.kind, size: info.size, at: now })))
}

/** This pane's attachments, oldest first. */
export const getSessionAttachments = (sessionId: string | null): SessionAttachment[] =>
  sessionId ? lists.get(sessionId) ?? EMPTY : EMPTY

export const subscribeSessionAttachments = (sessionId: string | null, listener: Listener): (() => void) => {
  if (!sessionId) return () => {}
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

/** Pane unmount: forget its list and revoke its image previews. The stored files are kept. */
export const releaseSessionMedia = (sessionId: string | null): void => {
  if (!sessionId) return
  releasePastedImage(sessionId)
  if (lists.delete(sessionId)) notify(sessionId)
}
