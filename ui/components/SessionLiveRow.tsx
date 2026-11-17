import { PanelBottom, SquareTerminal } from 'lucide-react'

import { showContextMenu } from '../ide/ui/Menu'
import { startPointerDrag } from '../ide/ui/pointerDrag'
import { usePanePresence } from '../utils/agentPresenceStore'
import type { StoredAgentSession } from '../utils/agentSessionStorage'
import { sessionRowLabel } from '../utils/sessionRowLabel'
import type { SessionNode } from '../utils/sessionsTree'
import { SESSION_DRAG } from '../workbench/sessions/sessionDrag'
import { SessionColorMark } from '../workbench/sessions/SessionColorMark'
import { sessionRowMenuItems } from '../workbench/sessions/sessionRowMenu'
import { AgentBadge } from './AgentBadge'

/** A running session of the Sessions tool window: shows it on click, its actions on right-click. */
export function SessionLiveRow({ session, stored, active, docked, indent, onShow }: {
  session: SessionNode
  stored: readonly StoredAgentSession[]
  active: boolean
  docked: boolean
  indent: string
  onShow: (sessionId: string) => void
}) {
  const presence = usePanePresence(session.id)
  const title = session.agent ? stored.find((item) => item.tabId === session.id)?.title : null
  const label = sessionRowLabel(session.name, session.agent ? presence?.profileName : null, title)
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => onShow(session.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          showContextMenu(event, sessionRowMenuItems(session.id, () => onShow(session.id)))
        }}
        onPointerDown={(event) => startPointerDrag(event, event.currentTarget, { type: SESSION_DRAG, payload: session.id })}
        className={`w-full flex items-center gap-2 ${indent} pr-2 py-1 rounded text-left text-xs hover:bg-[var(--theme-hover-bg)] ${
          active ? 'bg-[var(--theme-hover-bg)] text-theme-accent' : 'text-theme-fg'
        }`}
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
    </li>
  )
}
