import SessionsPanel, { type SessionsPanelChrome } from '../components/SessionsPanel'
import { IconButton } from '../ide/ui'
import { isAllScope, useSelectedWorkspace, useWorkspaceStore } from '../platform/workspaceStore'

import { useSessionCleanup } from './sessions/sessionCleanupStore'
import { useTempCleanup } from './tempCleanup/tempCleanupStore'
import { useShellPanels } from './shellPanelsStore'
import { isGroupCollapsed, useSessionsView } from './sessionsViewStore'

/** Sessions, with the session bookmarks as one of its views (there is no second Bookmarks window). */
export function SessionsToolWindow() {
  const props = useShellPanels((s) => s.sessions)
  const bookmarks = useShellPanels((s) => s.bookmarks)
  const view = useSessionsView()
  if (!props) return null
  const chrome: SessionsPanelChrome = {
    quickStartOpen: view.quickStartOpen,
    setQuickStartOpen: view.setQuickStartOpen,
    isCollapsed: (key) => isGroupCollapsed(view, key),
    toggleGroup: view.toggleGroup,
  }
  return <SessionsPanel {...props} bookmarks={bookmarks ?? undefined} chrome={chrome} />
}

/** The Sessions header: which workspace the sessions belong to, start a session, fold every project. */
export function SessionsHeaderActions() {
  const workspace = useSelectedWorkspace()
  const all = useWorkspaceStore(isAllScope)
  const label = all ? 'All workspaces' : workspace?.name
  const quickStartOpen = useSessionsView((s) => s.quickStartOpen)
  const setQuickStartOpen = useSessionsView((s) => s.setQuickStartOpen)
  const collapseAll = useSessionsView((s) => s.collapseAll)
  return (
    <>
      {label && (
        <span className="truncate max-w-[12ch] px-1 text-[11px] opacity-60" title={`Sessions of ${label}`} data-testid="sessions-workspace-label">
          {label}
        </span>
      )}
      <IconButton
        icon="plus"
        title="New Session…"
        size="small"
        aria-expanded={quickStartOpen}
        className={quickStartOpen ? 'active' : ''}
        onClick={() => setQuickStartOpen(!quickStartOpen)}
        data-feature="p2.sessions.addProject"
      />
      <IconButton
        icon="trash"
        title="Clean Up Old Sessions…"
        size="small"
        onClick={() => useSessionCleanup.getState().setOpen(true)}
        data-feature="p2.sessions.cleanup"
        data-testid="sessions-cleanup-button"
      />
      <IconButton
        icon="broom"
        title="Clean Temp Files…"
        size="small"
        onClick={() => useTempCleanup.getState().setOpen(true)}
        data-feature="p2.sessions.cleanTemp"
        data-testid="sessions-clean-temp-button"
      />
      <IconButton icon="collapse-all" title="Collapse All" size="small" onClick={collapseAll} data-feature="p2.sessions.collapse" />
    </>
  )
}
