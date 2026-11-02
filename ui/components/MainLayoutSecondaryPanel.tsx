import WorkspacePanel from './WorkspacePanel'
import BookmarksPanel from './BookmarksPanel'
import FileBrowser from './FileBrowser'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import type { MainLayoutModel } from './useMainLayoutController'

export default function MainLayoutSecondaryPanel({ model }: { model: MainLayoutModel }) {
  const {
    activeView,
    sidebarVisible,
    sidebarWidth,
    openEditor,
    scriptRuns,
    showAlert,
    handleConnect,
    hasConnectionProvider,
    setConnFormInitial,
    openConnectionForm,
    wsConnectionsRevision,
    revealRequest,
    activeTabId,
    editorTabs,
    requestNewSession,
    showTab,
    activeSshId,
    activeSshName,
  } = model

  return (
    <div
      className="flex-shrink-0 flex flex-col border-r border-[var(--theme-border)] min-w-0 overflow-hidden relative bg-theme-sidebar"
      style={{ width: sidebarVisible ? sidebarWidth : 0 }}
    >
      {activeView === 'workspace' ? (
        <WorkspacePanel
          onOpenScript={openEditor}
          onRunScript={scriptRuns.run}
          showAlert={showAlert}
          onConnectWorkspaceConnection={(connection, workspaceId) => handleConnect({ ...connection, workspaceId })}
          hasConnectionProvider={hasConnectionProvider}
          onAddWorkspaceConnection={(target) => { setConnFormInitial(undefined); openConnectionForm(target) }}
          onEditWorkspaceConnection={(target, conn) => { setConnFormInitial(conn); openConnectionForm(target) }}
          connectionsRevision={wsConnectionsRevision}
          revealRequest={revealRequest}
          activeFile={activeTabId && editorTabs[activeTabId] ? { workspaceId: editorTabs[activeTabId].workspaceId, path: editorTabs[activeTabId].script.id } : null}
          onWorkspacesChanged={model.refreshWorkspaces}
        />
      ) : activeView === 'bookmarks' ? (
        <BookmarksPanel
          onLaunch={(command, cwd) => requestNewSession(undefined, null, cwd ?? null, command)}
          onShowTab={showTab}
          launchCommandFor={(pin) => formatAgentProfileCommand(pin.agent, pin.launcher, pin.profileName)}
        />
      ) : activeView === 'files' && activeSshId && activeSshName ? (
        <FileBrowser key={activeSshId} id={activeSshId} connectionName={activeSshName} active={sidebarVisible} />
      ) : (
        <WorkspacePanel onOpenScript={openEditor} />
      )}
    </div>
  )
}
