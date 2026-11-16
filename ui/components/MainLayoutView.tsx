import { consumeForResume } from '../utils/storedSessionResume'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import { useWorkbenchBridge } from '../platform/useWorkbenchBridge'
import { WorkbenchFrame } from '../workbench/WorkbenchFrame'
import { SessionTabsShell } from '../workbench/sessions/SessionTabsShell'
import { showSessionTab } from '../workbench/sessions/sessionTabActions'
import { usePublishSessionBridge, useSyncEditorLayout } from '../workbench/sessions/usePublishSessionBridge'
import MainLayoutOverlays from './MainLayoutOverlays'
import { usePublishShellPanels } from './usePublishShellPanels'
import type { BookmarksPanelProps } from './BookmarksPanel'
import type { SessionsPanelProps } from './SessionsPanel'
import type { MainLayoutModel } from './useMainLayoutController'

/**
 * The OmniTerm shell inside the workbench. Every session is an editor tab (see workbench/sessions),
 * so the shell holds only what is not a tab: the sessions' terminals (portalled into their tab
 * surfaces), the layout controls on the right stripe, the panels the tool windows show, and dialogs.
 */
export default function MainLayoutView({ model }: { model: MainLayoutModel }) {
  const {
    appSettings, activeTabs, activeTabId, editorTabs, connById, requestNewSession,
  } = model
  useWorkbenchBridge({
    shortcuts: appSettings.shortcuts,
    focusedKind: activeTabId ? (editorTabs[activeTabId] ? 'editor' : 'terminal') : null,
    sessionCount: activeTabs.length,
    workspaceId: model.selectedWorkspaceId?.split('::')[0] ?? null,
    workspaceFolders: (model.workspaces ?? [])
      .find(workspace => workspace.id === model.selectedWorkspaceId?.split('::')[0])
      ?.folders.map(folder => folder.path).join('|') ?? '',
  })
  usePublishSessionBridge(model, true)
  useSyncEditorLayout(model, true)
  const sessionsPanelProps: SessionsPanelProps = {
    tabs: activeTabs,
    workspaces: model.workspaces ?? [],
    connById,
    isEditor: (id) => !!editorTabs[id],
    sessionCwds: model.sessionCwds ?? {},
    activeTabId,
    onShowTab: showSessionTab,
    onStart: (project, command) => requestNewSession(undefined, project?.workspaceId ?? model.selectedWorkspaceId, project?.cwd ?? null, command),
    onResume: (session, command) => { consumeForResume(session); requestNewSession(undefined, null, session.cwd ?? null, command) },
  }
  const bookmarksPanelProps: BookmarksPanelProps = {
    onLaunch: (command, cwd) => requestNewSession(undefined, null, cwd ?? null, command),
    onShowTab: showSessionTab,
    launchCommandFor: (pin) => formatAgentProfileCommand(pin.agent, pin.launcher, pin.profileName),
  }
  usePublishShellPanels(true, sessionsPanelProps, bookmarksPanelProps)
  return (
    <WorkbenchFrame>
      <SessionTabsShell model={model} />
      <MainLayoutOverlays model={model} />
    </WorkbenchFrame>
  )
}
