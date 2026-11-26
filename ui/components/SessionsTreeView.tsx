import { AlertTriangle, Bookmark, BookmarkX, ChevronDown, ChevronRight, Folder, Layers, Play, Plus, Terminal, X } from 'lucide-react'
import type { MouseEvent } from 'react'

import { removeStoredSession, setSessionBookmarked, type StoredAgentSession } from '../utils/agentSessionStorage'
import type { SessionGroup, SessionNode, SessionSection } from '../utils/sessionsTree'
import { resumeCommandFor } from '../utils/storedSessionResume'
import { sessionDisplayName } from '../utils/sessionDisplayName'
import { showContextMenu } from '../ide/ui/Menu'
import type { QuickStartProject } from '../utils/sessionQuickStart'
import { useWorkspaceStore } from '../platform/workspaceStore'
import { workspaceMenuItems } from '../workbench/titlebar/workspaceMenu'
import { currentClaudeProfiles, refreshClaudeProfiles } from '../utils/useClaudeProfiles'
import { claudeProfileMenuItems, projectStartMenuItems } from '../workbench/sessions/sessionRowMenu'
import { useTerminalDock } from '../workbench/terminalDock/terminalDockStore'
import { SessionLiveRow } from './SessionLiveRow'
import { Tooltip } from './Tooltip'

type ResumeHandler = (session: StoredAgentSession, command: string) => void

interface RowsProps {
  stored: readonly StoredAgentSession[]
  activeTabId: string | null
  onShowTab: (tabId: string) => void
  onResume: ResumeHandler
  isCollapsed: (key: string) => boolean
  toggleGroup: (key: string) => void
  /** Starts a terminal (null command) or an agent in a project folder. */
  onStart?: (project: QuickStartProject, command: string | null) => void
  /** The workspace the shown groups belong to, for sessions started from them. */
  workspaceId?: string | null
  highlightAgents?: boolean
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

/** An unfolded project without sessions says so, shows where it is and starts one in a click. */
function EmptyProjectRow({ group, indent, project, onStart }: {
  group: SessionGroup
  indent: string
  project: QuickStartProject | null
  onStart: RowsProps['onStart']
}) {
  return (
    <div className={`flex items-center gap-2 ${indent} pr-2 py-1 text-[11px] text-theme-dim`} data-testid="session-group-empty">
      <span className="truncate flex-1" title={group.cwd ?? group.label}>
        No sessions{group.cwd ? ` · ${group.cwd}` : ''}
      </span>
      {project && onStart && (
        <>
          <button type="button" className="rounded px-1 hover:text-theme-fg hover:bg-[var(--theme-hover-bg)]" onClick={() => onStart(project, null)}>Terminal</button>
          <button
            type="button"
            title="Start Claude (right-click to pick a profile)"
            className="rounded px-1 hover:text-theme-fg hover:bg-[var(--theme-hover-bg)]"
            onClick={() => onStart(project, 'claude')}
            onContextMenu={(event) => {
              event.preventDefault()
              showContextMenu(event, claudeProfileMenuItems(project, onStart, currentClaudeProfiles()))
              // The menu does not wait for the scan; a profile added since shows up the next time.
              void refreshClaudeProfiles()
            }}
          >
            Claude
          </button>
        </>
      )}
    </div>
  )
}

/** One project group: its header and, unless folded, its open and remembered sessions. */
function SessionGroupView({ group, nested, ...rows }: RowsProps & { group: SessionGroup; nested: boolean }) {
  const { stored, activeTabId, onShowTab, onResume, isCollapsed, toggleGroup, onStart, workspaceId, highlightAgents } = rows
  const collapsed = isCollapsed(group.key)
  // Sessions in the bottom Terminal tool window rather than an editor tab are marked as such.
  const docked = useTerminalDock((state) => state.docked)
  const indent = nested ? 'pl-10' : 'pl-6'
  // A local project folder can start sessions: right-click its row, or its "+".
  const project = group.cwd && onStart ? { key: group.key, label: group.label, cwd: group.cwd, workspaceId: workspaceId ?? '' } : null
  const openStartMenu = (event: MouseEvent) => {
    if (!project || !onStart) return
    showContextMenu(event, projectStartMenuItems(project, onStart, currentClaudeProfiles()))
    // The menu does not wait for the scan; a profile added since shows up the next time.
    void refreshClaudeProfiles()
  }
  return (
    <section className="mb-1" data-testid="session-group">
      <div className="group/project relative">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => toggleGroup(group.key)}
          onContextMenu={project ? (event) => { event.preventDefault(); openStartMenu(event) } : undefined}
          className={`${headerButton} ${nested ? 'pl-5 pr-1' : 'px-1'}`}
        >
          <Chevron collapsed={collapsed} />
          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
          <span className="truncate flex-1" title={group.cwd ?? group.label}>{group.label}</span>
          <span className={`text-[10px] text-theme-dim${project ? ' group-hover/project:invisible' : ''}`}>{group.sessions.length}</span>
        </button>
        {project && onStart && (
          <button
            type="button"
            aria-label={`Open terminal in ${group.label}`}
            title="Open a terminal here"
            onClick={() => onStart(project, null)}
            className={`${iconButton} absolute right-6 top-0.5 invisible group-hover/project:visible focus:visible`}
          >
            <Terminal className="w-3 h-3" />
          </button>
        )}
        {project && (
          <button
            type="button"
            aria-label={`New session in ${group.label}`}
            title="New terminal or agent in this folder"
            onClick={(event) => openStartMenu(event)}
            className={`${iconButton} absolute right-1 top-0.5 invisible group-hover/project:visible focus:visible`}
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>
      {!collapsed && group.sessions.length === 0 && <EmptyProjectRow group={group} indent={indent} project={project} onStart={onStart} />}
      {!collapsed && (
        <ul>
          {group.sessions.map(session => {
            if (session.stored) {
              const entry = stored.find(item => item.id === session.stored?.id)
              return entry ? <StoredRow key={session.id} node={session} session={entry} onResume={onResume} indent={indent} /> : null
            }
            return (
              <SessionLiveRow
                key={session.id}
                session={session}
                stored={stored}
                active={session.id === activeTabId}
                docked={docked.includes(session.id)}
                indent={indent}
                onShow={onShowTab}
                highlightAgent={highlightAgents}
              />
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
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === section.workspaceId))
  if (!titled) {
    return <>{section.groups.map(group => <SessionGroupView key={group.key} group={group} nested={false} {...rows} workspaceId={section.workspaceId ?? rows.workspaceId} />)}</>
  }
  const collapsed = rows.isCollapsed(section.key)
  const count = section.groups.reduce((total, group) => total + group.sessions.length, 0)
  return (
    <section className="mb-1" data-testid="session-section">
      <button type="button" aria-expanded={!collapsed} onClick={() => rows.toggleGroup(section.key)}
        onContextMenu={workspace ? (event) => { event.preventDefault(); showContextMenu(event, workspaceMenuItems(workspace)) } : undefined}
        className={`${headerButton} px-1 font-semibold`}>
        <Chevron collapsed={collapsed} />
        <Layers className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
        <span className="truncate flex-1" title={section.label}>{section.label}</span>
        <span className="text-[10px] font-normal text-theme-dim">{count}</span>
      </button>
      {!collapsed && section.groups.map(group => <SessionGroupView key={group.key} group={group} nested {...rows} workspaceId={section.workspaceId ?? rows.workspaceId} />)}
    </section>
  )
}
