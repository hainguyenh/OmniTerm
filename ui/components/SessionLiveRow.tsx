import { Bookmark, BookmarkX, PanelBottom, SquareTerminal } from 'lucide-react'

import { showContextMenu } from '../ide/ui/Menu'
import { startPointerDrag } from '../ide/ui/pointerDrag'
import { useAgentBookmark, type AgentBookmark } from '../utils/agentBookmark'
import { usePanePresence } from '../utils/agentPresenceStore'
import type { StoredAgentSession } from '../utils/agentSessionStorage'
import { sessionRowLabel } from '../utils/sessionRowLabel'
import type { SessionNode } from '../utils/sessionsTree'
import { SESSION_DRAG } from '../workbench/sessions/sessionDrag'
import { SessionColorMark } from '../workbench/sessions/SessionColorMark'
import { sessionRowMenuItems } from '../workbench/sessions/sessionRowMenu'
import { AgentBadge } from './AgentBadge'
import { Tooltip } from './Tooltip'

const BOOKMARK_TIP = {
  none: 'Bookmark session',
  pending: 'Bookmark pending (cancel)',
  bookmarked: 'Remove bookmark',
} as const

/**
 * Quick bookmark of a running agent session: always shown once bookmarked (or queued), revealed
 * on hover otherwise. A sibling of the row button, since buttons cannot nest.
 */
function QuickBookmark({ bookmark }: { bookmark: AgentBookmark }) {
  const { state, toggle } = bookmark
  const marked = state !== 'none'
  return (
    <Tooltip content={BOOKMARK_TIP[state]} placement="bottom">
      <button
        type="button"
        aria-label={BOOKMARK_TIP[state]}
        aria-pressed={state === 'bookmarked'}
        data-testid="session-quick-bookmark"
        data-state={state}
        onClick={toggle}
        className={`group/bookmark absolute right-1 top-0.5 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--theme-hover-bg)] ${
          marked ? 'text-theme-accent' : 'text-theme-dim hover:text-theme-fg invisible group-hover:visible focus:visible'
        }${state === 'pending' ? ' animate-pulse' : ''}`}
      >
        {state === 'bookmarked' && <BookmarkX className="w-3 h-3 hidden group-hover/bookmark:block" />}
        <Bookmark
          className={`w-3 h-3${state === 'bookmarked' ? ' group-hover/bookmark:hidden' : ''}`}
          fill={state === 'bookmarked' ? 'currentColor' : 'none'}
        />
      </button>
    </Tooltip>
  )
}

/** A running session of the Sessions tool window: shows it on click, its actions on right-click. */
export function SessionLiveRow({ session, stored, active, docked, indent, onShow, highlightAgent = false }: {
  session: SessionNode
  stored: readonly StoredAgentSession[]
  active: boolean
  docked: boolean
  indent: string
  onShow: (sessionId: string) => void
  /** Tint an agent's row lightly: the AI agents view makes agents easy to pick out. */
  highlightAgent?: boolean
}) {
  const presence = usePanePresence(session.id)
  const title = session.agent ? stored.find((item) => item.tabId === session.id)?.title : null
  const label = sessionRowLabel(session.name, session.agent ? presence?.profileName : null, title)
  const bookmark = useAgentBookmark(session.id)
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => onShow(session.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          showContextMenu(event, sessionRowMenuItems(session.id, () => onShow(session.id)))
        }}
        onPointerDown={(event) => startPointerDrag(event, event.currentTarget, { type: SESSION_DRAG, payload: session.id })}
        className={`w-full flex items-center gap-2 ${indent} ${bookmark ? 'pr-7' : 'pr-2'} py-1 rounded text-left text-xs hover:bg-[var(--theme-hover-bg)] ${
          active ? 'bg-[var(--theme-hover-bg)] text-theme-accent' : 'text-theme-fg'
        }${session.agent && highlightAgent && !active ? ' bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)]' : ''}`}
        data-agent-highlight={session.agent && highlightAgent ? '' : undefined}
      >
        {session.agent
          ? <AgentBadge agent={session.agent} className="w-3.5 h-3.5" />
          : <SquareTerminal className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />}
        <span className="truncate flex-1" title={label}>{label}</span>
        {docked && (
          <PanelBottom aria-label="In the Terminal tool window" data-testid="session-docked-mark" className="w-3 h-3 flex-shrink-0 text-theme-dim" />
        )}
        <SessionColorMark sessionId={session.id} className="flex-shrink-0" />
      </button>
      {bookmark && <QuickBookmark bookmark={bookmark} />}
    </li>
  )
}
