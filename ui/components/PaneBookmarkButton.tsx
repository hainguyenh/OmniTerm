import { Bookmark, BookmarkCheck } from 'lucide-react'

import { useBookmarkAgentSession } from '../hooks/useBookmarkAgentSession'
import { Tooltip } from './Tooltip'

const TOOLTIPS = {
  none: 'Bookmark this session to resume it later',
  pending: 'Bookmark queued: waiting for the agent to save its session. Click to cancel.',
  bookmarked: 'Bookmarked. Click to remove the bookmark.',
} as const

/** Sits right after the pane title: bookmarks the Claude session that pane is running. */
export function PaneBookmarkButton({ sessionId }: { sessionId: string }) {
  const { canBookmark, state, toggle } = useBookmarkAgentSession(sessionId)
  if (!canBookmark) return null
  const Icon = state === 'bookmarked' ? BookmarkCheck : Bookmark
  const tone = state === 'bookmarked'
    ? 'text-theme-accent'
    : state === 'pending'
      ? 'text-theme-warning animate-pulse'
      : 'text-theme-dim hover:text-theme-accent'
  return (
    <Tooltip content={TOOLTIPS[state]} placement="bottom">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle() }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#414868] transition-colors ${tone}`}
        aria-label={state === 'bookmarked' ? 'Remove bookmark' : 'Bookmark session'}
        aria-pressed={state === 'bookmarked'}
        data-bookmark-state={state}
      >
        <Icon className="w-3 h-3" fill={state === 'bookmarked' ? 'currentColor' : 'none'} />
      </button>
    </Tooltip>
  )
}
