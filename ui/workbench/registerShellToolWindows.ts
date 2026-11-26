import {
  useProjectHeaderMenu,
} from '../ide/features/project-tree/HeaderActions'
import { registerOverlay, registerToolWindow } from '../ide/workbench/contributions'
import { NOTIFICATIONS_TOOL_WINDOW } from '../ide/workbench/Notifications'
import { setDefaultStripeWindows } from '../ide/workbench/toolwindows/store'

import { CleanUpToolWindow } from './cleanup/CleanUpToolWindow'
import { CLEANUP_TOOL_WINDOW } from './cleanup/cleanUpViewStore'
import { CONNECTIONS_TOOL_WINDOW, ConnectionsHeaderActions, ConnectionsToolWindow } from './connections/ConnectionsToolWindow'
import { ProblemsToolWindow } from './problems/ProblemsToolWindow'
import { useProblemsStore } from './problems/problemsStore'
import { OmniTermProjectHeaderActions, ProjectToolWindow } from './ProjectToolWindow'
import { QUOTA_TOOL_WINDOW } from './quota/quotaDockState'
import { SessionCleanupOverlay } from './sessions/SessionCleanupDialog'
import { useSessionsBadge } from './sessions/useSessionsBadge'
import { TempCleanupOverlay } from './tempCleanup/TempCleanupDialog'
import { SessionsHeaderActions, SessionsToolWindow } from './ShellToolWindows'
import { registerShellIcons, SESSIONS_ICON, STICKY_NOTES_ICON } from './shellIcons'
import { StickyNotesToolWindow } from './notes/StickyNotesToolWindow'
import { useStickyNotesBadge } from './notes/useTempNotesList'
import { TERMINAL_WINDOW } from './terminalDock/terminalDockActions'
import { useWorkspaceTitleMenu } from './useWorkspaceTitleMenu'

/**
 * The tool windows that have a stripe button from the start, exactly the default stripe windows.
 * Every other window (Structure, TODO, Find, Database, ...) stays available from the menus and
 * gets its button once opened.
 */
/** Temporary notes (the former Activity Bar's Sticky Notes button). */
export const STICKY_NOTES_WINDOW = 'omniterm.notes'

export const STRIPE_WINDOWS: readonly string[] = [
  'project',
  'commit',
  'bookmarks',
  QUOTA_TOOL_WINDOW,
  'omniterm.sessions',
  CONNECTIONS_TOOL_WINDOW,
  STICKY_NOTES_WINDOW,
  CLEANUP_TOOL_WINDOW,
  TERMINAL_WINDOW,
  'run',
  'debug',
  'git',
  'problems',
  NOTIFICATIONS_TOOL_WINDOW,
]

/**
 * Shell tool windows (Project, Sessions, Connections, Sticky Notes, Clean Up, and Problems). Session bookmarks live inside
 * Sessions; the Bookmarks stripe button belongs to the editor (editor bookmarks).
 * They have `requiresProject: false`, so they remain accessible even when no workspace is open.
 */
export function registerShellToolWindows(): () => void {
  const disposers = [
    registerShellIcons(),
    setDefaultStripeWindows(STRIPE_WINDOWS),
    registerToolWindow({
      id: 'project',
      title: 'Project',
      icon: 'toolwindow-project',
      anchor: 'left',
      order: 0,
      requiresProject: false,
      component: ProjectToolWindow,
      headerActions: OmniTermProjectHeaderActions,
      headerMenu: useProjectHeaderMenu,
      titleMenu: useWorkspaceTitleMenu,
    }),
    registerToolWindow({
      id: 'omniterm.sessions',
      title: 'Sessions',
      icon: SESSIONS_ICON,
      anchor: 'left',
      order: 31,
      requiresProject: false,
      component: SessionsToolWindow,
      headerActions: SessionsHeaderActions,
      // Like the Commit badge: the AI agents running in the panes the Sessions panel lists.
      useBadge: useSessionsBadge,
    }),
    registerToolWindow({
      id: CONNECTIONS_TOOL_WINDOW,
      title: 'Connections',
      icon: 'web',
      anchor: 'left',
      // Between Sessions (31) and Sticky Notes (32).
      order: 31.5,
      requiresProject: false,
      component: ConnectionsToolWindow,
      headerActions: ConnectionsHeaderActions,
    }),
    registerToolWindow({
      id: STICKY_NOTES_WINDOW,
      title: 'Sticky Notes',
      icon: STICKY_NOTES_ICON,
      anchor: 'left',
      order: 32,
      requiresProject: false,
      component: StickyNotesToolWindow,
      useBadge: useStickyNotesBadge,
    }),
    registerToolWindow({
      id: CLEANUP_TOOL_WINDOW,
      title: 'Clean Up',
      icon: 'broom',
      anchor: 'left',
      // After Sticky Notes (32).
      order: 33,
      requiresProject: false,
      component: CleanUpToolWindow,
    }),
    registerOverlay({ id: 'omniterm.sessions.cleanup', component: SessionCleanupOverlay }),
    registerOverlay({ id: 'omniterm.temp.cleanup', component: TempCleanupOverlay }),
    registerToolWindow({
      id: 'problems',
      title: 'Problems',
      icon: 'alert-triangle',
      anchor: 'bottom',
      // Last on the bottom stripe group: Terminal, Run, Debug, Git, Problems.
      order: 30,
      requiresProject: false,
      component: ProblemsToolWindow,
      useBadge: () =>
        useProblemsStore(
          (s) => (s.totalErrors + s.totalWarnings > 0 ? s.totalErrors + s.totalWarnings : null),
        ),
    }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
