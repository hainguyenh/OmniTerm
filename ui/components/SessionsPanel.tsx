import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Connection, Workspace } from '../domain'

import { useStoredSessions, type StoredAgentSession } from '../utils/agentSessionStorage'
import { useAllPanePresence } from '../utils/agentPresenceStore'
import type { QuickStartProject } from '../utils/sessionQuickStart'
import { buildSessionsTree, resumableCount, type SessionsFilter, type SessionsTreeTab } from '../utils/sessionsTree'
import { scopedWorkspaceId, selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'
import BookmarksPanel, { type BookmarksPanelProps } from './BookmarksPanel'
import { SessionSectionView } from './SessionsTreeView'
import { SessionsQuickStart } from './SessionsQuickStart'
import { Tooltip } from './Tooltip'

export interface SessionsPanelProps {
  tabs: readonly SessionsTreeTab[]
  workspaces: readonly Workspace[]
  connById: (id: string) => Connection | undefined
  isEditor: (tabId: string) => boolean
  sessionCwds: Readonly<Record<string, string>>
  activeTabId: string | null
  onShowTab: (tabId: string) => void
  /** Start a session: an agent command or, with a null command, a plain terminal. */
  onStart: (project: QuickStartProject | null, command: string | null) => void
  /** Open a fresh pane that resumes a remembered agent session. */
  onResume: (session: StoredAgentSession, command: string) => void
  /** When given, a Bookmarks view (pinned workspaces, bookmarked sessions) joins the filter chips. */
  bookmarks?: BookmarksPanelProps
  /**
   * Set when the panel sits in a tool window whose header carries the title and the buttons: the
   * panel then draws no header of its own, and the quick start and folding follow this state.
   */
  chrome?: SessionsPanelChrome
}

/** The view state a tool window header shares with the panel. */
export interface SessionsPanelChrome {
  quickStartOpen: boolean
  setQuickStartOpen: (open: boolean) => void
  isCollapsed: (groupKey: string) => boolean
  toggleGroup: (groupKey: string) => void
}

/** Tool window listing every open terminal and agent of the workspace, grouped by project. */
const SessionsPanel: React.FC<SessionsPanelProps> = ({
  tabs, workspaces, connById, isEditor, sessionCwds, activeTabId, onShowTab, onStart, onResume, bookmarks, chrome,
}) => {
  const [view, setView] = useState<SessionsFilter | 'bookmarks'>('all')
  const showBookmarks = view === 'bookmarks' && bookmarks !== undefined
  const filter: SessionsFilter = view === 'bookmarks' ? 'all' : view
  const [ownQuickStartOpen, setOwnQuickStartOpen] = useState(false)
  const [ownCollapsed, setOwnCollapsed] = useState<Readonly<Record<string, boolean>>>({})
  const quickStartOpen = chrome ? chrome.quickStartOpen : ownQuickStartOpen
  const setQuickStartOpen = chrome ? chrome.setQuickStartOpen : setOwnQuickStartOpen
  const isCollapsed = chrome ? chrome.isCollapsed : (key: string) => ownCollapsed[key] ?? false
  const toggleGroup = chrome
    ? chrome.toggleGroup
    : (key: string) => setOwnCollapsed(previous => ({ ...previous, [key]: !(previous[key] ?? false) }))
  const presence = useAllPanePresence()
  const stored = useStoredSessions()
  const scopeWorkspaceId = useWorkspaceStore(scopedWorkspaceId)
  const currentWorkspaceId = useWorkspaceStore((state) => selectedWorkspaceId(state.selection))
  const sections = useMemo(() => buildSessionsTree({
    tabs, workspaces, connById, isEditor, filter, stored, scopeWorkspaceId,
    // An agent pane belongs to the folder it was started in, even after the shell moved elsewhere.
    cwdOf: (id) => presence[id]?.launchCwd ?? sessionCwds[id],
    agentOf: (id) => presence[id]?.agent,
  }), [tabs, workspaces, connById, isEditor, filter, stored, scopeWorkspaceId, sessionCwds, presence])
  const resumable = resumableCount(stored)
  const filters: ReadonlyArray<{ id: SessionsFilter | 'bookmarks'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'terminals', label: 'Terminals' },
    { id: 'agents', label: 'AI agents' },
    ...(resumable > 0 ? [{ id: 'resume' as const, label: `Resume (${resumable})` }] : []),
    ...(bookmarks ? [{ id: 'bookmarks' as const, label: 'Bookmarks' }] : []),
  ]

  return (
    <div className="relative flex flex-col h-full min-h-0" data-testid="sessions-panel">
      {!chrome && (
        <div className="flex items-center gap-2 px-3 h-9 flex-shrink-0 border-b border-[var(--theme-border)]">
          <span className="text-xs font-semibold text-theme-fg flex-1">Sessions</span>
          <Tooltip content="Start a session" placement="bottom">
            <button
              type="button"
              aria-label="New session"
              aria-expanded={quickStartOpen}
              onClick={() => setQuickStartOpen(!quickStartOpen)}
              className="w-6 h-6 inline-flex items-center justify-center rounded text-theme-dim hover:text-theme-fg hover:bg-[var(--theme-hover-bg)]"
            >
              <Plus className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      )}
      {quickStartOpen && (
        <SessionsQuickStart
          workspaces={workspaces}
          workspaceId={scopeWorkspaceId ?? currentWorkspaceId}
          onStart={onStart}
          onClose={() => setQuickStartOpen(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 flex-shrink-0">
        {filters.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={`px-2 py-0.5 rounded-full text-[11px] border ${
              view === id
                ? 'border-theme-accent text-theme-accent bg-[var(--theme-hover-bg)]'
                : 'border-[var(--theme-border)] text-theme-dim hover:text-theme-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {showBookmarks && bookmarks && (
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="sessions-bookmarks-view">
          <BookmarksPanel {...bookmarks} />
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto px-1 pb-2${showBookmarks ? ' hidden' : ''}`}>
        {sections.every(section => section.groups.length === 0) && <p className="px-3 py-2 text-xs text-theme-dim">No open sessions.</p>}
        {sections.map(section => (
          <SessionSectionView
            key={section.key}
            section={section}
            titled={scopeWorkspaceId === null}
            stored={stored}
            activeTabId={activeTabId}
            onShowTab={onShowTab}
            onResume={onResume}
            onStart={onStart}
            workspaceId={scopeWorkspaceId ?? currentWorkspaceId}
            highlightAgents={filter === 'agents'}
            isCollapsed={isCollapsed}
            toggleGroup={toggleGroup}
          />
        ))}
      </div>
    </div>
  )
}

export default SessionsPanel
