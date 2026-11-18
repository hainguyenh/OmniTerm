import {
  useProjectHeaderMenu,
  useProjectTitleMenu,
} from '../ide/features/project-tree/HeaderActions'
import { registerOverlay, registerToolWindow } from '../ide/workbench/contributions'
import { NOTIFICATIONS_TOOL_WINDOW } from '../ide/workbench/Notifications'
import { useVcs } from '../ide/features/vcs/store'
import { useActiveAgentCount } from '../utils/agentPresenceStore'
import { setDefaultStripeWindows } from '../ide/workbench/toolwindows/store'

import { ProblemsToolWindow } from './problems/ProblemsToolWindow'
import { useProblemsStore } from './problems/problemsStore'
import { OmniTermProjectHeaderActions, ProjectToolWindow } from './ProjectToolWindow'
import { QUOTA_TOOL_WINDOW } from './quota/quotaDockState'
import { ScmToolWindow } from './scm/ScmToolWindow'
import { SessionCleanupOverlay } from './sessions/SessionCleanupDialog'
import { TempCleanupOverlay } from './tempCleanup/TempCleanupDialog'
import { SessionsHeaderActions, SessionsToolWindow } from './ShellToolWindows'
import { registerShellIcons, SESSIONS_ICON } from './shellIcons'
import { TERMINAL_WINDOW } from './terminalDock/terminalDockActions'

/**
 * The tool windows that have a stripe button from the start, exactly the default stripe windows.
 * Every other window (Structure, TODO, Find, Database, ...) stays available from the menus and
 * gets its button once opened.
 */
/** Source Control with a section per project, next to the IDE's Commit window. */
export const SCM_TOOL_WINDOW = 'omniterm.scm'

export const STRIPE_WINDOWS: readonly string[] = [
  'project',
  'commit',
  SCM_TOOL_WINDOW,
  'bookmarks',
  QUOTA_TOOL_WINDOW,
  'omniterm.sessions',
  TERMINAL_WINDOW,
  'run',
  'debug',
  'git',
  'problems',
  NOTIFICATIONS_TOOL_WINDOW,
]

/**
 * Shell tool windows (Project, Sessions, and Problems). Session bookmarks live inside
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
      titleMenu: useProjectTitleMenu,
    }),
    registerToolWindow({
      id: SCM_TOOL_WINDOW,
      title: 'Source Control',
      icon: 'toolwindow-git',
      anchor: 'left',
      order: 12,
      requiresProject: true,
      component: ScmToolWindow,
      useBadge: () => useVcs((s) => (s.status.length > 0 ? s.status.length : null)),
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
      // Like the Commit badge: how many AI agents are running in open panes.
      useBadge: useActiveAgentCount,
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
