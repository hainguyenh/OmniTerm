import { useEffect } from 'react'

import { registerAction } from '../ide/platform/actions'
import { consumeForResume } from '../utils/storedSessionResume'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import { useWorkbenchBridge } from '../platform/useWorkbenchBridge'
import { useBlurPlugin } from '../hooks/useBlurPlugin'
import { WorkbenchFrame } from '../workbench/WorkbenchFrame'
import { SessionTabsShell } from '../workbench/sessions/SessionTabsShell'
import { showSessionTab } from '../workbench/sessions/sessionTabActions'
import { usePublishSessionBridge, useSyncEditorLayout } from '../workbench/sessions/usePublishSessionBridge'
import BlurSettingsOverlay from './BlurSettingsOverlay'
import ConnectionForm from './ConnectionForm'
import MainLayoutOverlays from './MainLayoutOverlays'
import { usePublishConnectionsHost } from './usePublishConnectionsHost'
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
    appSettings, activeTabs, activeTabId, editorTabs, connById, connFormOpen, setConnFormOpen, connFormInitial,
    connFormTarget, wsConnFormRef, connectionCapabilities, requestNewSession, handleSaveConnection,
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
  const { open: blurOpen, setOpen: setBlurOpen, available: blurAvailable } = useBlurPlugin()
  // The blur settings used to sit on the activity bar; they are an action (Find Action) now.
  useEffect(() => {
    if (!blurAvailable) return undefined
    return registerAction({
      id: 'omniterm.blurSettings',
      title: 'Inactive Window Blur Settings',
      category: 'View',
      verbatim: true,
      run: () => setBlurOpen(true),
    })
  }, [blurAvailable, setBlurOpen])
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
  usePublishConnectionsHost(model)
  return (
    <WorkbenchFrame>
      <SessionTabsShell model={model} blurAvailable={blurAvailable} />
      {connFormOpen && connFormTarget && (
        <ConnectionForm
          folders={connFormTarget.folders}
          capabilities={connectionCapabilities}
          scopeLabel={connFormTarget.rootLabel}
          rootLabel={connFormTarget.rootLabel} allowRootParent={false}
          initial={connFormInitial}
          defaultParentId={connFormTarget.parentPath || undefined}
          onClose={() => { setConnFormOpen(false); wsConnFormRef.current = null }}
          onSave={handleSaveConnection}
        />
      )}
      <MainLayoutOverlays model={model} />
      {blurOpen && blurAvailable && (
        <BlurSettingsOverlay
          strength={appSettings.blurInactiveWindow ?? 0}
          blurDock={appSettings.blurInactiveDock ?? false}
          enabled={appSettings.blurEnabled ?? true}
          onSave={(blurInactiveWindow, blurInactiveDock, blurEnabled) => {
            const next = { ...appSettings, blurInactiveWindow, blurInactiveDock, blurEnabled }
            model.setAppSettings(next)
            window.omnitermAPI.settings.save(next)
          }}
          onClose={() => setBlurOpen(false)}
        />
      )}
    </WorkbenchFrame>
  )
}
