/**
 * Bookmark the Claude session running in one pane, so it survives the pane (as a `saved` entry on
 * the launch page and in the Bookmarks view) and is never expired.
 *
 * The state is derived from the stores, never from a local timer: it stays "bookmarked" for as
 * long as the stored entry says so. When the session id is not known yet (Claude has not
 * written its session file), the request is queued and applied by the pane poll once it resolves.
 */
import { getPanePresence } from './agentPresenceStore'
import {
  cancelPendingBookmark,
  isBookmarkPending,
  isBookmarked,
  loadStoredSessions,
  requestPendingBookmark,
  setSessionBookmarked,
} from './agentSessionStorage'

type BookmarkState = 'none' | 'pending' | 'bookmarked'

function bookmarkStateFor(tabId: string, agentSessionId: string | undefined, agent: string | undefined): BookmarkState {
  const sessions = loadStoredSessions()
  const entry = sessions.find(item => item.tabId === tabId)
    ?? (agent && agentSessionId ? sessions.find(item => item.id === `${agent}:${agentSessionId}`) : undefined)
  if (entry && isBookmarked(entry)) return 'bookmarked'
  return isBookmarkPending(tabId) ? 'pending' : 'none'
}

function toggleBookmark(tabId: string, agent: string, agentSessionId: string | undefined, state: BookmarkState): void {
  if (state === 'pending') {
    cancelPendingBookmark(tabId)
    return
  }
  const sessions = loadStoredSessions()
  const entry = sessions.find(item => item.tabId === tabId)
    ?? (agentSessionId ? sessions.find(item => item.id === `${agent}:${agentSessionId}`) : undefined)
  if (!entry) {
    // Resolved but not yet stored (the poll stores it right after): queue it the same way.
    requestPendingBookmark(tabId)
    return
  }
  setSessionBookmarked(entry.id, state !== 'bookmarked')
}

/** The bookmark of the agent session in a pane, read once (menus); null when no agent runs there. */
export function agentBookmark(tabId: string): { state: BookmarkState; toggle: () => void } | null {
  const presence = getPanePresence(tabId)
  const agent = presence?.agent
  if (!agent) return null
  const agentSessionId = presence.agentSessionId ?? presence.claudeSessionId
  const state = bookmarkStateFor(tabId, agentSessionId, agent)
  return { state, toggle: () => toggleBookmark(tabId, agent, agentSessionId, state) }
}
