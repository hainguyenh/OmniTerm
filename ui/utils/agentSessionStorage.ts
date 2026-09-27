/**
 * Storage for resumable Claude sessions: the running pane it belongs to (`active`), a pane whose
 * session outlived the window that held it (`interrupted`), or a bookmarked session whose pane is
 * gone (`saved`). A bookmark is a flag, not a state: a running session can be bookmarked and stays
 * `active` until its pane closes, and only then becomes `saved` instead of being forgotten.
 *
 * Only fields that pass strict validation are ever kept — a stray or forged localStorage entry
 * cannot become an executable resume command (see `agentSessionDetector.ts` for the UUID and
 * launcher shapes required). This also means the previous, looser schema (which stored prompt text
 * and a ready-made shell command) is dropped wholesale on first load rather than migrated.
 */
import { useSyncExternalStore } from 'react'
import { isValidLauncher, isValidSessionId } from './agentSessionDetector'
import { registerDurableSlice, scheduleDurableSave } from './agentSessionDurable'

export type StoredSessionState = 'active' | 'interrupted' | 'saved'

export interface StoredAgentSession {
  /** `claude:<sessionId>` — stable across restarts, and naturally dedupes by session. */
  id: string
  /** The pane tab id this session is bound to, while `state` is `active` or `interrupted`. */
  tabId?: string
  agent: 'claude'
  launcher?: string
  profileName: string
  sessionId: string
  cwd?: string
  folderName?: string
  /** The agent's own work-item title (from its terminal title), when it reported one. */
  title?: string
  /** Kept by the user: survives tab close (as `saved`) and is exempt from expiry. */
  bookmarked?: boolean
  state: StoredSessionState
  updatedAt: number
}

const STORAGE_KEY = 'omniterm:agent-sessions'
const CHANGE_EVENT = 'omniterm:agent-sessions-changed'
const MAX_ENTRIES = 20
const MAX_BOOKMARKS = 100
const MAX_TITLE_LENGTH = 200
const EXPIRE_MS = 14 * 24 * 60 * 60 * 1000
/** A poll re-upserting identical data inside this window is not worth a storage write. */
const REFRESH_MS = 60_000

let memoryStore: StoredAgentSession[] = []
let cache: StoredAgentSession[] | null = null
/** Tabs whose bookmark was requested before their Claude session id could be resolved. */
const pendingBookmarks = new Set<string>()

function isValidEntry(item: unknown): item is StoredAgentSession {
  if (!item || typeof item !== 'object') return false
  const s = item as Record<string, unknown>
  return typeof s.id === 'string'
    && s.agent === 'claude'
    && isValidSessionId(s.sessionId)
    && typeof s.profileName === 'string' && s.profileName.trim().length > 0
    && (s.state === 'active' || s.state === 'interrupted' || s.state === 'saved')
    && typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)
    && (s.tabId === undefined || typeof s.tabId === 'string')
    && (s.launcher === undefined || isValidLauncher(s.launcher))
    && (s.cwd === undefined || typeof s.cwd === 'string')
    && (s.folderName === undefined || typeof s.folderName === 'string')
    && (s.title === undefined || (typeof s.title === 'string' && s.title.length <= MAX_TITLE_LENGTH))
    && (s.bookmarked === undefined || typeof s.bookmarked === 'boolean')
}

/** A `saved` entry from before bookmarks became a flag was always a bookmark. */
function normalize(entry: StoredAgentSession): StoredAgentSession {
  return entry.state === 'saved' && !entry.bookmarked ? { ...entry, bookmarked: true } : entry
}

export function isBookmarked(entry: StoredAgentSession): boolean {
  return entry.bookmarked === true || entry.state === 'saved'
}

function notifyChange(): void {
  cache = null
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  }
}

function sanitize(items: unknown[], now: number): StoredAgentSession[] {
  return items
    .filter(isValidEntry)
    .map(normalize)
    .filter(item => isBookmarked(item) || now - item.updatedAt <= EXPIRE_MS)
}

export function loadStoredSessions(): StoredAgentSession[] {
  if (cache !== null) return cache
  if (typeof localStorage === 'undefined') {
    cache = memoryStore
    return cache
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? sanitize(parsed, Date.now()) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(sessions: StoredAgentSession[]): void {
  const newestFirst = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const capped = [
    ...newestFirst.filter(isBookmarked).slice(0, MAX_BOOKMARKS),
    ...newestFirst.filter(item => !isBookmarked(item)).slice(0, MAX_ENTRIES),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
  memoryStore = capped
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
    } catch {
      // Storage quota or unavailable — memory still has this tick's value.
    }
  }
  notifyChange()
  scheduleDurableSave()
}

function sameExceptTimestamp(a: StoredAgentSession, b: StoredAgentSession): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof StoredAgentSession>
  keys.delete('updatedAt')
  return [...keys].every(key => a[key] === b[key])
}

/**
 * Insert or merge by `id`. Fields the caller leaves out (a poll never knows about the bookmark or
 * always the title) keep their stored value instead of being wiped.
 */
export function upsertSession(session: StoredAgentSession): void {
  const current = loadStoredSessions()
  const existing = current.find(item => item.id === session.id)
  const merged: StoredAgentSession = existing
    ? {
        ...existing,
        ...session,
        bookmarked: session.bookmarked ?? existing.bookmarked,
        title: session.title ?? existing.title,
      }
    : session
  if (merged.bookmarked === undefined) delete merged.bookmarked
  if (merged.title === undefined) delete merged.title
  if (existing && sameExceptTimestamp(existing, merged) && merged.updatedAt - existing.updatedAt < REFRESH_MS) return
  persist([...current.filter(item => item.id !== session.id), merged])
}

/**
 * What the pane poll calls once it has resolved which Claude session runs in `session.tabId`. Any
 * other session still bound to that tab has ended (the user ran `/clear`, or restarted Claude), so
 * it is released the same way a closed tab releases it. A bookmark the user asked for before the
 * id was known is applied here.
 */
export function bindActiveSession(session: StoredAgentSession): void {
  const tabId = session.tabId
  if (tabId) {
    const current = loadStoredSessions()
    const stale = current.filter(item => item.tabId === tabId && item.state === 'active' && item.id !== session.id)
    if (stale.length > 0) persist(releaseEntries(current, new Set(stale.map(item => item.id))))
  }
  const bookmark = tabId !== undefined && pendingBookmarks.delete(tabId)
  upsertSession(bookmark ? { ...session, bookmarked: true } : session)
}

/** Bookmarked entries lose their tab and become `saved`; everything else is dropped. */
function releaseEntries(current: StoredAgentSession[], ids: Set<string>): StoredAgentSession[] {
  return current.flatMap(item => {
    if (!ids.has(item.id)) return [item]
    if (!isBookmarked(item)) return []
    const { tabId: _tabId, ...rest } = item
    return [{ ...rest, state: 'saved' as const, updatedAt: Date.now() }]
  })
}

export function setSessionBookmarked(id: string, bookmarked: boolean): void {
  const current = loadStoredSessions()
  const entry = current.find(item => item.id === id)
  if (!entry) return
  // An unbookmarked session with no pane left has nothing to resume into; forget it.
  if (!bookmarked && entry.state === 'saved') {
    persist(current.filter(item => item.id !== id))
    return
  }
  persist(current.map(item => item.id === id ? { ...item, bookmarked, updatedAt: Date.now() } : item))
}

export function requestPendingBookmark(tabId: string): void {
  pendingBookmarks.add(tabId)
  notifyChange()
}

export function cancelPendingBookmark(tabId: string): void {
  if (pendingBookmarks.delete(tabId)) notifyChange()
}

export function isBookmarkPending(tabId: string): boolean {
  return pendingBookmarks.has(tabId)
}

export function removeStoredSession(id: string): void {
  const current = loadStoredSessions()
  const next = current.filter(item => item.id !== id)
  if (next.length !== current.length) persist(next)
}

/**
 * Stop tracking this tab's *live* session — its agent exited, or the tab itself closed. Only an
 * `active` entry is released this way: a bookmarked one becomes `saved`, anything else is dropped.
 * An `interrupted` entry for the same tab id survives so it still shows up for resume (in the
 * overlay, or on the dashboard) until the user acts on it or it expires.
 */
export function clearActiveForTab(tabId: string): void {
  pendingBookmarks.delete(tabId)
  const current = loadStoredSessions()
  const ids = new Set(current.filter(item => item.tabId === tabId && item.state === 'active').map(item => item.id))
  if (ids.size > 0) persist(releaseEntries(current, ids))
}

export function findSessionByTabId(tabId: string): StoredAgentSession | undefined {
  return loadStoredSessions().find(item => item.tabId === tabId && item.state !== 'saved')
}

/** The `interrupted` session bound to this tab id, if any — what the pane overlay renders. */
export function findInterruptedSessionByTabId(tabId: string): StoredAgentSession | undefined {
  return loadStoredSessions().find(item => item.tabId === tabId && item.state === 'interrupted')
}

export function clearStoredSessions(): void {
  pendingBookmarks.clear()
  persist([])
}

/**
 * Called once at startup: any entry still marked `active` belongs to a tab id from the previous
 * run, which cannot exist yet in this one. Whether the app was closed cleanly or killed, that pane
 * is gone, so its session becomes `interrupted` (resumable) rather than silently active forever.
 */
export function promoteStaleActiveSessions(): void {
  const current = loadStoredSessions()
  let changed = false
  const next = current.map(item => {
    if (item.state !== 'active') return item
    changed = true
    return { ...item, state: 'interrupted' as const }
  })
  if (changed) persist(next)
}

/**
 * Merge entries read back from the crash-safe file: per id, the newer write wins. An entry still
 * `active` from before this run started is promoted exactly as `promoteStaleActiveSessions` does.
 */
function hydrateFromFile(items: unknown[], startedAt: number): void {
  const byId = new Map(loadStoredSessions().map(item => [item.id, item]))
  let changed = false
  for (const fromFile of sanitize(items, Date.now())) {
    const local = byId.get(fromFile.id)
    if (local && local.updatedAt >= fromFile.updatedAt) continue
    byId.set(fromFile.id, fromFile)
    changed = true
  }
  const merged = [...byId.values()].map(item => item.state === 'active' && item.updatedAt < startedAt
    ? { ...item, state: 'interrupted' as const }
    : item)
  if (changed) persist(merged)
}

registerDurableSlice('sessions', { read: () => loadStoredSessions(), hydrate: hydrateFromFile })

export function subscribeStoredSessions(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

export function useStoredSessions(): StoredAgentSession[] {
  return useSyncExternalStore(subscribeStoredSessions, loadStoredSessions, () => [])
}
