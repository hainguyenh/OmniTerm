/**
 * Storage for resumable Claude sessions: the running pane it belongs to (`active`), a pane whose
 * session outlived the window that held it (`interrupted`), or one the user bookmarked (`saved`).
 *
 * Only fields that pass strict validation are ever kept — a stray or forged localStorage entry
 * cannot become an executable resume command (see `agentSessionDetector.ts` for the UUID and
 * launcher shapes required). This also means the previous, looser schema (which stored prompt text
 * and a ready-made shell command) is dropped wholesale on first load rather than migrated.
 */
import { useSyncExternalStore } from 'react'
import { isValidLauncher, isValidSessionId } from './agentSessionDetector'

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
  state: StoredSessionState
  updatedAt: number
}

const STORAGE_KEY = 'omniterm:agent-sessions'
const CHANGE_EVENT = 'omniterm:agent-sessions-changed'
const MAX_ENTRIES = 20
const EXPIRE_MS = 14 * 24 * 60 * 60 * 1000

let memoryStore: StoredAgentSession[] = []
let cache: StoredAgentSession[] | null = null

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
}

function notifyChange(): void {
  cache = null
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  }
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
    const now = Date.now()
    cache = Array.isArray(parsed)
      ? parsed.filter(isValidEntry).filter(item => now - item.updatedAt <= EXPIRE_MS)
      : []
  } catch {
    cache = []
  }
  return cache
}

function persist(sessions: StoredAgentSession[]): void {
  const capped = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES)
  memoryStore = capped
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
    } catch {
      // Storage quota or unavailable — memory still has this tick's value.
    }
  }
  notifyChange()
}

/** Insert or replace by `id`, most-recent first. */
export function upsertSession(session: StoredAgentSession): void {
  const next = loadStoredSessions().filter(item => item.id !== session.id)
  next.push(session)
  persist(next)
}

export function removeStoredSession(id: string): void {
  const current = loadStoredSessions()
  const next = current.filter(item => item.id !== id)
  if (next.length !== current.length) persist(next)
}

/**
 * Stop tracking this tab's *live* session — its agent exited, or the tab itself closed. Only an
 * `active` entry is ever removed this way: an `interrupted` or `saved` entry for the same tab id
 * survives so it still shows up for resume (in the overlay, or on the dashboard) until the user
 * acts on it or it expires.
 */
export function clearActiveForTab(tabId: string): void {
  const current = loadStoredSessions()
  const next = current.filter(item => !(item.tabId === tabId && item.state === 'active'))
  if (next.length !== current.length) persist(next)
}

export function findSessionByTabId(tabId: string): StoredAgentSession | undefined {
  return loadStoredSessions().find(item => item.tabId === tabId && item.state !== 'saved')
}

/** The `interrupted` session bound to this tab id, if any — what the pane overlay renders. */
export function findInterruptedSessionByTabId(tabId: string): StoredAgentSession | undefined {
  return loadStoredSessions().find(item => item.tabId === tabId && item.state === 'interrupted')
}

export function clearStoredSessions(): void {
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

export function subscribeStoredSessions(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

export function useStoredSessions(): StoredAgentSession[] {
  return useSyncExternalStore(subscribeStoredSessions, loadStoredSessions, () => [])
}
