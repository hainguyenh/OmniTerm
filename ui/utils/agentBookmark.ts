/**
 * Bookmark the Claude session running in one pane, so it survives the pane (as a `saved` entry on
 * the launch page and in the Bookmarks view) and is never expired.
 *
 * The state is derived from the stores, never from a local timer: it stays "bookmarked" for as
 * long as the stored entry says so. When the session id is not known yet (Claude has not
 * written its session file), the request is queued and applied by the pane poll once it resolves.
 */
import { getPanePresence, usePanePresence, type PanePresence } from './agentPresenceStore'
import {
  cancelPendingBookmark,
  isBookmarkPending,
  isBookmarked,
  loadStoredSessions,
  requestPendingBookmark,
  setSessionBookmarked,
  useStoredSessions,
  type StoredAgentSession,
} from './agentSessionStorage'

export type BookmarkState = 'none' | 'pending' | 'bookmarked'

export interface AgentBookmark {
  state: BookmarkState
  toggle: () => void
}

/**
 * The entry of the session that runs in the pane now. The pane's resolved session id wins; else
 * the `active` entry bound to the tab. An `interrupted` entry of a restored pane can share its tab
 * id but belongs to an earlier conversation, so it is never the one a bookmark lands on.
 */
function liveEntryFor(sessions: readonly StoredAgentSession[], tabId: string, presence: PanePresence): StoredAgentSession | undefined {
  const agentSessionId = presence.agentSessionId ?? presence.claudeSessionId
  const id = agentSessionId === 'latest' ? `${presence.agent}:${presence.agent}-${tabId}` : `${presence.agent}:${agentSessionId}`
  return (agentSessionId ? sessions.find(item => item.id === id) : undefined)
    ?? sessions.find(item => item.tabId === tabId && item.state === 'active')
}

function bookmarkFor(sessions: readonly StoredAgentSession[], tabId: string, presence: PanePresence | undefined): AgentBookmark | null {
  if (!presence?.agent) return null
  const entry = liveEntryFor(sessions, tabId, presence)
  const state: BookmarkState = entry && isBookmarked(entry) ? 'bookmarked' : isBookmarkPending(tabId) ? 'pending' : 'none'
  const toggle = () => {
    if (state === 'pending') {
      cancelPendingBookmark(tabId)
      return
    }
    // Read again: the poll may have stored the session since this state was rendered.
    const current = liveEntryFor(loadStoredSessions(), tabId, presence)
    if (!current) {
      // Resolved but not yet stored (the poll stores it right after): queue it the same way.
      requestPendingBookmark(tabId)
      return
    }
    setSessionBookmarked(current.id, state !== 'bookmarked')
  }
  return { state, toggle }
}

/** The bookmark of the agent session in a pane, read once (menus); null when no agent runs there. */
export function agentBookmark(tabId: string): AgentBookmark | null {
  return bookmarkFor(loadStoredSessions(), tabId, getPanePresence(tabId))
}

/** The same bookmark, kept current for a row that shows it (Sessions tool window). */
export function useAgentBookmark(tabId: string): AgentBookmark | null {
  const sessions = useStoredSessions()
  const presence = usePanePresence(tabId)
  return bookmarkFor(sessions, tabId, presence)
}
