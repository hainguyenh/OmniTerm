/**
 * Bookmark the Claude session running in one pane, so it survives the pane (as a `saved` entry on
 * the launch page and in the Bookmarks view) and is never expired.
 *
 * The button's state is derived from the stores, never from a local timer: it stays "bookmarked"
 * for as long as the stored entry says so. When the session id is not known yet (Claude has not
 * written its session file), the request is queued and applied by the pane poll once it resolves.
 */
import { useSyncExternalStore } from 'react'
import { usePanePresence } from '../utils/agentPresenceStore'
import {
  cancelPendingBookmark,
  isBookmarkPending,
  isBookmarked,
  loadStoredSessions,
  requestPendingBookmark,
  setSessionBookmarked,
  subscribeStoredSessions,
} from '../utils/agentSessionStorage'

export type BookmarkState = 'none' | 'pending' | 'bookmarked'

function bookmarkStateFor(tabId: string, claudeSessionId: string | undefined): BookmarkState {
  const entry = claudeSessionId
    ? loadStoredSessions().find(item => item.id === `claude:${claudeSessionId}`)
    : undefined
  if (entry && isBookmarked(entry)) return 'bookmarked'
  return isBookmarkPending(tabId) ? 'pending' : 'none'
}

export function useBookmarkAgentSession(tabId: string | null | undefined) {
  const presence = usePanePresence(tabId)
  const claudeSessionId = presence?.agent === 'claude' ? presence.claudeSessionId : undefined
  const state = useSyncExternalStore(
    subscribeStoredSessions,
    () => (tabId ? bookmarkStateFor(tabId, claudeSessionId) : 'none'),
    () => 'none' as const,
  )

  const toggle = () => {
    if (!tabId || presence?.agent !== 'claude') return
    if (state === 'pending') {
      cancelPendingBookmark(tabId)
      return
    }
    if (!claudeSessionId) {
      requestPendingBookmark(tabId)
      return
    }
    const id = `claude:${claudeSessionId}`
    if (!loadStoredSessions().some(item => item.id === id)) {
      // Resolved but not yet stored (the poll stores it right after): queue it the same way.
      requestPendingBookmark(tabId)
      return
    }
    setSessionBookmarked(id, state !== 'bookmarked')
  }

  return { canBookmark: presence?.agent === 'claude', state, toggle }
}
