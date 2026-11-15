import { AlertTriangle, Bookmark, BookmarkX, ChevronDown, ChevronRight, Folder, Layers, Play, SquareTerminal, X } from 'lucide-react'

import { removeStoredSession, setSessionBookmarked, type StoredAgentSession } from '../utils/agentSessionStorage'
import type { SessionGroup, SessionNode, SessionSection } from '../utils/sessionsTree'
import { resumeCommandFor } from '../utils/storedSessionResume'
import { sessionDisplayName } from '../utils/sessionDisplayName'
import { startPointerDrag } from '../ide/ui/pointerDrag'
import { SESSION_DRAG } from '../workbench/sessions/sessionDrag'
import { SessionColorMark } from '../workbench/sessions/SessionColorMark'
import { AgentBadge } from './AgentBadge'
import { Tooltip } from './Tooltip'

type ResumeHandler = (session: StoredAgentSession, command: string) => void

interface RowsProps {
  stored: readonly StoredAgentSession[]
  activeTabId: string | null
  onShowTab: (tabId: string) => void
  onResume: ResumeHandler
  isCollapsed: (key: string) => boolean
  toggleGroup: (key: string) => void
}

const iconButton = 'w-5 h-5 inline-flex items-center justify-center rounded text-theme-dim hover:text-theme-fg hover:bg-[var(--theme-hover-bg)]'
const headerButton = 'w-full flex items-center gap-1.5 py-1 rounded text-left text-xs text-theme-fg hover:bg-[var(--theme-hover-bg)]'

function Chevron({ collapsed }: { collapsed: boolean }) {
  return collapsed
    ? <ChevronRight className="w-3 h-3 flex-shrink-0 text-theme-dim" aria-hidden="true" />
    : <ChevronDown className="w-3 h-3 flex-shrink-0 text-theme-dim" aria-hidden="true" />
}

function StoredRow({ node, session, onResume, indent }: { node: SessionNode; session: StoredAgentSession; onResume: ResumeHandler; indent: string }) {
  const stored = node.stored
  if (!stored) return null
  const command = resumeCommandFor(session)
  const interrupted = stored.state === 'interrupted'
  return (
    <li className={`group flex items-center gap-2 ${indent} pr-2 py-1 rounded text-xs text-theme-dim hover:bg-[var(--theme-hover-bg)]`} data-testid="stored-session-row">
      {interrupted
        ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-theme-warning" aria-label="Interrupted" />
        : <Bookmark className="w-3.5 h-3.5 flex-shrink-0 text-theme-accent" aria-label="Bookmarked" />}
      <span className="truncate flex-1" title={node.name}>{sessionDisplayName(node.name)}</span>
      <span className="text-[10px]">{interrupted ? 'interrupted' : 'bookmark'}</span>
      {command && (
        <Tooltip content="Resume" placement="bottom">
          <button type="button" aria-label={`Resume ${node.name}`} className={iconButton} onClick={() => onResume(session, command)}>
            <Play className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={stored.bookmarked ? 'Remove bookmark' : 'Discard'} placement="bottom">
        <button
          type="button"
          aria-label={`${stored.bookmarked ? 'Remove bookmark' : 'Discard'} ${node.name}`}
          className={iconButton}
          onClick={() => (stored.bookmarked ? setSessionBookmarked(stored.id, false) : removeStoredSession(stored.id))}
        >
          {stored.bookmarked ? <BookmarkX className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </button>
      </Tooltip>
    </li>
  )
}

/** One project group: its header and, unless folded, its open and remembered sessions. */
function SessionGroupView({ group, nested, ...rows }: RowsProps & { group: SessionGroup; nested: boolean }) {
  const { stored, activeTabId, onShowTab, onResume, isCollapsed, toggleGroup } = rows
  const collapsed = isCollapsed(group.key)
  const indent = nested ? 'pl-10' : 'pl-6'
  return (
    <section className="mb-1" data-testid="session-group">
      <button type="button" aria-expanded={!collapsed} onClick={() => toggleGroup(group.key)} className={`${headerButton} ${nested ? 'pl-5 pr-1' : 'px-1'}`}>
        <Chevron collapsed={collapsed} />
        <Folder className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
        <span className="truncate flex-1" title={group.label}>{group.label}</span>
        <span className="text-[10px] text-theme-dim">{group.sessions.length}</span>
      </button>
      {!collapsed && (
        <ul>
          {group.sessions.map(session => {
            if (session.stored) {
              const entry = stored.find(item => item.id === session.stored?.id)
              return entry ? <StoredRow key={session.id} node={session} session={entry} onResume={onResume} indent={indent} /> : null
            }
            return (
              <li key={session.id}>
                <button
                  type="button"
                  aria-current={session.id === activeTabId ? 'true' : undefined}
                  onClick={() => onShowTab(session.id)}
                  onPointerDown={(event) => startPointerDrag(event, event.currentTarget, { type: SESSION_DRAG, payload: session.id })}
                  className={`w-full flex items-center gap-2 ${indent} pr-2 py-1 rounded text-left text-xs hover:bg-[var(--theme-hover-bg)] ${
                    session.id === activeTabId ? 'bg-[var(--theme-hover-bg)] text-theme-accent' : 'text-theme-fg'
                  }`}
                >
                  {session.agent
                    ? <AgentBadge agent={session.agent} className="w-3.5 h-3.5" />
                    : <SquareTerminal className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />}
                  <span className="truncate flex-1" title={session.name}>{sessionDisplayName(session.name)}</span>
                  <SessionColorMark sessionId={session.id} className="flex-shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * A workspace's project groups. `titled` (every workspace is listed) adds a foldable workspace row
 * above them; a single scoped workspace shows its projects at the top level.
 */
export function SessionSectionView({ section, titled, ...rows }: RowsProps & { section: SessionSection; titled: boolean }) {
  if (!titled) {
    return <>{section.groups.map(group => <SessionGroupView key={group.key} group={group} nested={false} {...rows} />)}</>
  }
  const collapsed = rows.isCollapsed(section.key)
  const count = section.groups.reduce((total, group) => total + group.sessions.length, 0)
  return (
    <section className="mb-1" data-testid="session-section">
      <button type="button" aria-expanded={!collapsed} onClick={() => rows.toggleGroup(section.key)} className={`${headerButton} px-1 font-semibold`}>
        <Chevron collapsed={collapsed} />
        <Layers className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
        <span className="truncate flex-1" title={section.label}>{section.label}</span>
        <span className="text-[10px] font-normal text-theme-dim">{count}</span>
      </button>
      {!collapsed && section.groups.map(group => <SessionGroupView key={group.key} group={group} nested {...rows} />)}
    </section>
  )
}
