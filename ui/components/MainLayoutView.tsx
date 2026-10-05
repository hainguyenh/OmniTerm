import React, { useEffect } from 'react'
import type { SessionStatus } from '@omniterm/contract'
import { workingFolderLabel, workspaceLocationLabel } from '../utils/workspaceDisplay'
import { newTerminalHoverText } from '../utils/newTerminalDescription'
import ActivityBar from './ActivityBar'
import FileBrowser from './FileBrowser'
import WorkspacePanel from './WorkspacePanel'
import BookmarksPanel from './BookmarksPanel'
import { GitWorkspaceView } from './git/GitWorkspaceView'
import { EditorTabHost } from './editor/EditorTabHost'
import TerminalView from './TerminalView'
import RDPView from './RDPView'
import ConnectingOverlay from './ConnectingOverlay'
import DetachedPlaceholder from './DetachedPlaceholder'
import SessionUnavailableOverlay from './SessionUnavailableOverlay'
import ConnectionForm from './ConnectionForm'
import LayoutSessionFooter, { PaneSessionFooter } from './LayoutSessionFooter'
import SessionTabs from './SessionTabs'
import WaitingPane from './WaitingPane'
import { PaneResizers } from './PaneResizers'
import { Columns2, LayoutGrid, RotateCw, Square } from 'lucide-react'
import { paneIdentity } from '../paneIdentity'
import { draggedPaneIndex, paneRect } from '../paneLayout'
import { closesOnExit } from '../sessionExit'
import { isRenewing } from '../hooks/useRenewSession'
import { useGitRepoCheck } from '../hooks/useGitRepoCheck'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import { resolveEnterModes } from '../utils/enterKeys'
import { shellLabel } from '../shellOptions'
import { workspaceForConnection } from '../utils/workspaceIdentity'
import { Grid3Icon, Grid5Icon, Grid6Icon, Grid7Icon, Grid8Icon } from './mainLayoutShared'
import MainLayoutOverlays from './MainLayoutOverlays'
import FullscreenRestoreControl from './FullscreenRestoreControl'
import MainLayoutWaitingPane from './MainLayoutWaitingPane'
import { createTerminalAppearance } from './terminalAppearance'
import { PaneSessionOverlayHost } from './PaneSessionOverlayHost'
import type { MainLayoutModel } from './useMainLayoutController'
import ViewGroupTabs from './ViewGroupTabs'
import { Tooltip } from './Tooltip'
import BlurSettingsOverlay from './BlurSettingsOverlay'
import { useBlurPlugin } from '../hooks/useBlurPlugin'
import { notifyViewGroupReorder, notifyViewGroupUngroup, notifyViewGroupUpdate } from '../viewGroups'
import { QuotaPaneLines, SuspendedOverlay, UsageProbeOverlay } from '../../plugins/agent-quota/app/paneHosts'
export default function MainLayoutView({ model }: { model: MainLayoutModel }) {
  const { appSettings, setAppSettings, currentTheme, themes, resolveAppearance, onFontSizeChange, layoutMode, setSettingsOpen, hasConnectionProvider, connectionCapabilities, activeTabs, visibleTabs = activeTabs, setActiveTabs, tabGroups = {}, ephemeralConns, panes, focusedPane, setFocusedPane, activeTabId, setTabMenu, setShellMenu, setPanePicker, setPanePickerAnchor = () => {}, dragPane, setDragPane, statuses, setSessionCwd, reconnectKeys, latencies, poppedOut, resumeMode, metrics, connectedAt, setStatus, setLatency, setMetric, activity, setBusy, connById, reattachTerminal, connFormOpen, setConnFormOpen, connFormInitial, setConnFormInitial, connFormTarget, wsConnFormRef, wsConnectionsRevision, openConnectionForm, showAlert, sidebarWidth, activeView, sidebarVisible, editorTabs, setEditorDirty, previewTabId, keepTab, handleResizeDragStart, handleViewChange, revealRequest, revealInWorkspace, splitRatios, setSplitRatios, persistRatios, shellOptions, requestNewSession, handleSaveConnection, showTab, changeLayoutMode, swapPanes, handleConnect, scriptRuns, openEditor, closeTabs, closeTab, disconnectSession, reconnectSession, retryRestore = () => {}, restoreOutcomes = {}, activeSshId, activeSshName, isOverlayOpen, detachControl, renderPaneHeader, idleArtUrl, loadingArtUrl, alwaysAwake: awakeState, setAlwaysAwakeOpen, alwaysAwakeAvailable, viewGroups = [], activeGroupId = '', switchViewGroup = () => {}, fullscreenPane = null, setFullscreenPane = () => {}, chromeHidden = false, pulsePaneId = null } = model
  const handleRestoreStatus = model.handleRestoreStatus ?? setStatus
  const alwaysAwake = awakeState ?? {
    enabled: false, mode: 'activeOnly' as const, expiresAtMs: 0,
    activeSessionCount: 0, keepingAwake: false, supported: true, error: null,
  }
  const { open: blurOpen, setOpen: setBlurOpen, available: blurAvailable } = useBlurPlugin()
  const blurValue = appSettings.blurInactiveWindow ?? 0
  const fullscreenTabId = fullscreenPane === null ? null : panes[fullscreenPane] ?? null
  const ungroupedTabCount = activeTabs.filter(tab => !tabGroups[tab.id]).length
  const selectedWorkspace = (model.workspaces ?? []).find(workspace => workspace.id === model.selectedWorkspaceId?.split('::')[0])
  const activeEditorWorkspace = activeTabId ? model.editorTabs[activeTabId]?.workspaceId : undefined
  const activeConnId = activeTabId ? activeTabs.find(tab => tab.id === activeTabId)?.connId : undefined
  const activeConnection = activeConnId ? connById(activeConnId) : undefined
  const activeTarget = activeTabId && activeConnId ? { id: activeTabId, connId: activeConnId } : null
  const activeResolvedAppearance = activeTarget ? resolveAppearance?.(activeTarget.id, activeTarget.connId) : undefined
  const activeTerminalAppearance = activeTarget ? createTerminalAppearance({
    themes, appSettings, resolved: activeResolvedAppearance, target: activeTarget,
    onThemeApply: model.onThemeApply, onFontSizeChange: model.onFontSizeChange, onToolbarActionsChange: model.onToolbarActionsChange,
  }) : undefined
  const footerWorkspace = (model.workspaces ?? []).find(workspace => workspace.id === activeEditorWorkspace) ?? (activeTabId ? workspaceForConnection(model.workspaces ?? [], activeConnection) : selectedWorkspace)
  const rawActiveCwd = activeTabId ? (model.sessionCwds?.[activeTabId] ?? activeConnection?.localCwd) : undefined
  const activeRepoCwd = rawActiveCwd || (footerWorkspace?.folders?.[0]?.path) || selectedWorkspace?.folders?.[0]?.path
  const isGitRepo = useGitRepoCheck(activeRepoCwd, appSettings.gitUtilEnabled ?? true)
  const gitEnabled = (appSettings.gitUtilEnabled ?? true) && isGitRepo
  useEffect(() => {
    if (!gitEnabled && activeView === 'git') handleViewChange(null)
  }, [gitEnabled, activeView, handleViewChange])
  const footerWorkspaceTitle = workspaceLocationLabel(footerWorkspace)
  const footerWorkingFolder = activeTabId ? workingFolderLabel(rawActiveCwd, model.workspaces ?? []) : undefined
  const localFooterLocationLabel = footerWorkingFolder ?? footerWorkspaceTitle
  const activeShellLabel = activeConnection?.type === 'LOCAL' ? shellLabel(shellOptions ?? [], activeConnection.shell) : undefined
  const newSessionTitle = newTerminalHoverText(
    shellOptions ?? [], appSettings.defaultShell, model.workspaces ?? [],
    model.selectedWorkspaceId ?? null, model.homeDir ?? '',
  )
  const onPaneDrop = (event: React.DragEvent, target: number) => {
    const source = draggedPaneIndex(event.dataTransfer.getData('text/plain'), layoutMode)
    if (source !== null) swapPanes(source, target)
    setDragPane(null)
  }
  const waitingPane = <MainLayoutWaitingPane model={model} customArtUrl={idleArtUrl} />
    return (
      <div className="h-full w-full flex bg-theme-bg overflow-hidden">
        {!chromeHidden && (
          <ActivityBar
            activeView={activeView}
            filesEnabled={!!activeSshId && connectionCapabilities?.sftp === true}
            gitEnabled={gitEnabled}
            onViewChange={handleViewChange}
            onSettingsClick={() => setSettingsOpen(true)}
            alwaysAwakeAvailable={alwaysAwakeAvailable}
            alwaysAwakeEnabled={alwaysAwake.enabled}
            alwaysAwakeKeepingAwake={alwaysAwake.keepingAwake}
            onAlwaysAwakeClick={() => setAlwaysAwakeOpen(true)}
            blurAvailable={blurAvailable}
            blurEnabled={(appSettings.blurEnabled ?? true) && blurValue > 0}
            onBlurClick={() => setBlurOpen(true)}
          />
        )}
        {/* ── Secondary Panel (Workspace/Connections/Files) ────────────────── */}
        {!chromeHidden && activeView !== null && activeView !== 'git' && (
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
        )}
        {!chromeHidden && activeView !== null && activeView !== 'git' && sidebarVisible && (
          <div
            className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-[var(--theme-accent)] transition-colors active:bg-[var(--theme-accent)] z-10"
            onMouseDown={handleResizeDragStart}
          />
        )}
        {/* ── Main area ───────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {gitEnabled && activeView === 'git' && (
            <div className="absolute inset-0 z-40 bg-theme-bg flex flex-col min-w-0 overflow-hidden">
              <GitWorkspaceView
                cwd={rawActiveCwd}
                workspaces={model.workspaces}
                savedConnections={model.savedConnections}
                gitGraphEnabled={appSettings.gitGraphEnabled ?? true}
                onClose={() => handleViewChange(null)}
              />
            </div>
          )}
          {!chromeHidden && (
          <div className="relative z-30 flex flex-col border-b border-[var(--theme-border)] flex-shrink-0">
            {viewGroups.length > 0 && <ViewGroupTabs groups={viewGroups} activeGroupId={activeGroupId} totalTabCount={ungroupedTabCount} onSelect={id => { setFullscreenPane(null); switchViewGroup(id) }} onUpdate={notifyViewGroupUpdate} onReorder={notifyViewGroupReorder} onUngroup={notifyViewGroupUngroup} />}
            <div className="h-[40px] px-2.5 flex items-center gap-2">
            {/* Tab list — flex-1 so it fills all available space before the picker */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <SessionTabs
                tabs={visibleTabs} panes={panes} layoutMode={layoutMode} focusedPane={focusedPane}
                statuses={statuses} activity={activity}
                isEditor={(id) => !!editorTabs[id]}
                isPreview={(id) => previewTabId === id}
                isEphemeral={(connId) => ephemeralConns.some(e => e.id === connId)}
                connType={(connId) => connById(connId)?.type}
                getShellLabel={(connId) => {
                  const conn = connById(connId)
                  if (!conn) return undefined
                  if (conn.type === 'LOCAL') return shellLabel(shellOptions ?? [], conn.shell)
                  return undefined
                }}
                connName={(connId) => connById(connId)?.name}
                connCwd={(connId) => connById(connId)?.localCwd}
                onSelect={showTab}
                onPromote={keepTab}
                onClose={closeTab}
                onContextMenu={(e, id) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: id }) }}
                onNewSession={() => requestNewSession(undefined, model.selectedWorkspaceId)}
                newSessionTitle={newSessionTitle}
                onPickShell={(rect) => setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
                onPickPane={layoutMode > 1
                  ? (rect) => {
                      setPanePickerAnchor(rect)
                      setPanePicker(Math.min(focusedPane, layoutMode - 1))
                    }
                  : undefined}
                detachTabId={layoutMode === 1 ? activeTabId : null}
                detachAction={layoutMode === 1 && activeTabId ? detachControl.stateOf(activeTabId) : null}
                onToggleDetach={() => { if (activeTabId) detachControl.toggle(activeTabId) }}
                onReveal={revealInWorkspace}
              />
            </div>
  
            {/* Header controls: Layout picker. Renew lives in each terminal's own header. */}
            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
              <div className="flex items-center rounded-lg border border-[var(--theme-border)] overflow-hidden bg-black/10 flex-shrink-0">
              {([
                [1, Square, 'Single view'],
                [2, Columns2, 'Split 2'],
                [3, Grid3Icon, 'Split 3'],
                [4, LayoutGrid, 'Grid 4'],
                [5, Grid5Icon, 'Split 5'],
                [6, Grid6Icon, 'Grid 6'],
                [7, Grid7Icon, 'Split 7'],
                [8, Grid8Icon, 'Grid 8']
              ] as const).map(([m, Icon, label]) => {
                const disabled = m > 1 && activeGroupId === 'ungrouped' && visibleTabs.length === 0
                  const tooltipText = disabled
                  ? 'Cannot select multi-view when ungrouped with no open tabs'
                  : m === 3 && layoutMode === 3 ? `${label} (${appSettings.split3Style || 'left'}) - Click to cycle`
                  : m === 2 && layoutMode === 2 ? `${label} (${appSettings.split2Style || 'columns'}) - Click to toggle`
                  : (m === 5 || m === 7) && layoutMode === m ? `${label} (${appSettings.split3Style === 'top' ? 'horizontal' : 'vertical'}) - Click to switch`
                  : label
                return (
                  <Tooltip key={m} content={tooltipText} shortcut={disabled ? undefined : `Ctrl+${m}`} placement="bottom">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={tooltipText}
                      onClick={() => {
                        if (disabled) return
                        if (m === 3 && layoutMode === 3) {
                          const currentStyle = appSettings.split3Style || 'left'
                          const nextStyle = currentStyle === 'left' ? 'right' : currentStyle === 'right' ? 'top' : 'left'
                          setAppSettings({ ...appSettings, split3Style: nextStyle })
                          window.omnitermAPI.settings.save({ split3Style: nextStyle })
                        } else if (m === 2 && layoutMode === 2) {
                          const nextStyle = (appSettings.split2Style || 'columns') === 'columns' ? 'rows' : 'columns'
                          setAppSettings({ ...appSettings, split2Style: nextStyle })
                          window.omnitermAPI.settings.save({ split2Style: nextStyle })
                        } else if ((m === 5 || m === 7) && layoutMode === m) {
                          const nextStyle = appSettings.split3Style === 'top' ? 'left' : 'top'
                          setAppSettings({ ...appSettings, split3Style: nextStyle })
                          window.omnitermAPI.settings.save({ split3Style: nextStyle })
                        } else {
                          changeLayoutMode(m)
                        }
                      }}
                      className={`relative inline-flex items-center justify-center w-6 h-6 transition-colors ${
                        disabled ? 'opacity-20 cursor-not-allowed'
                        : `hover:bg-white/5 ${
                            layoutMode === m
                              ? 'bg-white/10 text-[var(--theme-accent)] font-bold'
                              : 'text-inherit opacity-50 hover:opacity-100'
                          }`
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${((m === 2 && layoutMode === 2 && appSettings.split2Style === 'rows') || ((m === 3 || m === 5 || m === 7) && layoutMode === m && appSettings.split3Style === 'top')) ? 'rotate-90' : ''}`} />
                      {m === 3 && layoutMode === 3 && (
                        <RotateCw className="absolute -top-1 -right-1 w-2.5 h-2.5 text-theme-accent" />
                      )}
                      {m === 2 && layoutMode === 2 && (
                        <RotateCw className="absolute -top-1 -right-1 w-2.5 h-2.5 text-theme-accent" />
                      )}
                      {(m === 5 || m === 7) && layoutMode === m && (
                        <RotateCw className="absolute -top-1 -right-1 w-2.5 h-2.5 text-theme-accent" />
                      )}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            </div>
            </div>
          </div>
          )}

          <LayoutSessionFooter
            activeTabId={activeTabId}
            conn={activeConnection}
            footerWorkspaceTitle={footerWorkspaceTitle}
            localLocationLabel={localFooterLocationLabel}
            shellLabel={activeShellLabel}
            statuses={statuses}
            latencies={latencies}
            metrics={metrics}
            connectedAt={connectedAt}
            layoutMode={layoutMode}
            activity={activity}
            appearance={activeTerminalAppearance}
            rawCwd={rawActiveCwd}
            gitEnabled={gitEnabled}
            onReconnect={reconnectSession}
            onDisconnect={disconnectSession}
          />
          {/* Session content; hidden panes remain mounted to preserve terminal scroll state.
              overflow-hidden clips oversized xterm canvases instead of scrolling the whole
              desktop — panes must stay inside the container, never scroll it. */}
          <div className="flex-1 min-w-0 min-h-0 mt-1 overflow-hidden">
          <div
            className="relative isolate h-full"
          >
            {fullscreenTabId && <FullscreenRestoreControl sessionName={activeTabs.find(tab => tab.id === fullscreenTabId)?.name} onRestore={() => setFullscreenPane(null)} />}
            {activeTabs.length === 0 ? (
              waitingPane
            ) : (
              <>
                {/* Keep sessions mounted while the group index catches up after a layout change. */}
                {layoutMode === 1 && (visibleTabs.length === 0 || !panes[0]) && (
                  <div className="absolute inset-0 z-30 bg-theme-bg">{waitingPane}</div>
                )}
                {/* Empty-pane frames (split view only). Filled panes draw their own chrome in
                    the session wrapper below (so the header sits above the native RDP window).
                    Each frame is a drop target and hosts a quick-pick to fill the slot. */}
                {layoutMode > 1 && !fullscreenTabId && Array.from({ length: layoutMode }).map((_, i) => {
                  if (panes[i]) return null
                  const isFocused = i === focusedPane
                  const isDropTarget = dragPane !== null && dragPane !== i
                  return (
                    <div
                      key={`frame-${i}`}
                      className="absolute z-10 p-0.5 overflow-hidden"
                      style={paneRect(i, layoutMode, appSettings.split3Style, appSettings.split2Style, splitRatios)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={(e) => { e.preventDefault(); onPaneDrop(e, i) }}
                    >
                      <div
                        onMouseDown={() => setFocusedPane(i)}
                        style={isFocused && !isDropTarget ? { borderColor: paneIdentity(i).color } : undefined}
                        className={`h-full w-full flex flex-col rounded-lg border ${
                          isDropTarget ? 'border-dashed border-theme-accent' : isFocused ? '' : 'border-theme-border'
                        }`}
                      >
                        {renderPaneHeader(i, null)}
                        {/* The idle pane shows the app's waiting page; both of its actions still
                            target THIS pane (the picker only opens from its own button). */}
                        <div className="flex-1 min-h-0">
                          <WaitingPane
                            dark={!!appSettings.darkMode}
                            compact
                            paneIndex={i}
                            openSessionCount={visibleTabs.length}
                            onNewSession={() => { setFocusedPane(i); requestNewSession(undefined, model.selectedWorkspaceId) }}
                            newSessionTitle={newSessionTitle}
                            onPickShell={(rect) => { setFocusedPane(i); setShellMenu({ x: rect.left, y: rect.bottom + 4 }) }}
                            onChooseSession={(rect) => { setPanePickerAnchor(rect); setPanePicker(i) }}
                            customArtUrl={idleArtUrl}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
  
                {/* Draggable boundaries. Above the frames, below the pane content. */}
                {!fullscreenTabId && <PaneResizers mode={layoutMode} ratios={splitRatios}
                  split3Style={appSettings.split3Style ?? 'left'} split2Style={appSettings.split2Style ?? 'columns'}
                  onChange={setSplitRatios} onCommit={persistRatios} />}
  
                {/* Session views — one per open tab, positioned into its pane (or hidden). */}
                {activeTabs.map(tab => {
                  const conn = connById(tab.connId)
                  const appearance = resolveAppearance?.(tab.id, tab.connId) ?? {}
                  const terminalTheme = themes.find(theme => theme.id === (appearance.themeId ?? appSettings.themeId)) ?? currentTheme
                  const terminalFontSize = appearance.fontSize ?? appSettings.fontSize
                  const terminalTarget = { id: tab.id, connId: tab.connId }
                  const sourcePaneIdx = panes.findIndex((p, i) => p === tab.id && i < layoutMode)
                  const visible = fullscreenTabId ? tab.id === fullscreenTabId : sourcePaneIdx !== -1
                  const paneIdx = fullscreenTabId ? 0 : sourcePaneIdx
                  const split = !fullscreenTabId && visible && layoutMode > 1
                  const isFocused = sourcePaneIdx === focusedPane
                  const isDropTarget = split && dragPane !== null && dragPane !== paneIdx
                  const style: React.CSSProperties = fullscreenTabId && visible
                    ? { left: 0, top: 0, width: '100%', height: '100%' }
                    : visible && layoutMode > 1
                    ? paneRect(paneIdx, layoutMode, appSettings.split3Style, appSettings.split2Style, splitRatios)
                    : { left: 0, top: 0, width: '100%', height: '100%' }
                  const editor = editorTabs[tab.id]
                  const restoreOutcome = restoreOutcomes[tab.id]
                  const restoreBlocked = restoreOutcome?.phase === 'pending' || restoreOutcome?.phase === 'failed'
                  const sessionView = editor ? (
                    <EditorTabHost tabId={tab.id} editor={editor} visible={visible} closeTab={closeTab}
                      keepTab={keepTab} runScript={scriptRuns.run} setEditorDirty={setEditorDirty} />
                  ) : restoreBlocked ? (
                    <SessionUnavailableOverlay
                      message={restoreOutcome.message}
                      onRestart={restoreOutcome.retryable && restoreOutcome.phase !== 'pending'
                        ? () => retryRestore(tab.id)
                        : undefined}
                      actionLabel="Restart terminal"
                    />
                  ) : conn?.type === 'RDP' ? (
                    <RDPView
                      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`}
                      id={tab.id}
                      connection={conn}
                      active={visible}
                      paneEpoch={`${fullscreenTabId ? 'fullscreen' : layoutMode}:${sourcePaneIdx}`}
                      overlayActive={isOverlayOpen}
                      onStatus={(status: SessionStatus) => handleRestoreStatus(tab.id, status)}
                      onLatency={(ms: number | null) => setLatency(tab.id, ms)}
                    />
                  ) : poppedOut[tab.id] ? (
                    <DetachedPlaceholder
                      name={tab.name}
                      onFocus={() => window.omnitermAPI.terminalWindow.focus(tab.id)}
                      // Capture the CURRENT focused slot at click time — never the pane the tab
                      // used to live in before it was popped out.
                      onReattach={() => reattachTerminal(tab.id, focusedPane)}
                    />
                  ) : (
                    <TerminalView
                      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`} id={tab.id} connection={conn!}
                      mode={resumeMode[tab.id] ? 'attach' : 'connect'}
                      onRestart={() => reconnectSession(tab.id)}
                      // A hidden pane keeps its layout box, so it can no longer infer this from its
                      // own size — it has to be told. Drives focus and the scroll-tail restore.
                      active={visible}
                      layoutEpoch={`${fullscreenTabId ? 'fullscreen' : layoutMode}:${sourcePaneIdx}`}
                      darkMode={appSettings.darkMode}
                      blurStrength={blurAvailable && (appSettings.blurEnabled ?? true) && appSettings.blurInactiveDock ? appSettings.blurInactiveWindow ?? 0 : 0}
                      // The process a renew replaces ends on purpose; its closed/error is not the pane's state.
                      onStatus={(status: SessionStatus) => { if (!(isRenewing(tab.id) && (status === 'closed' || status === 'error'))) handleRestoreStatus(tab.id, status) }}
                      onMetrics={(m) => setMetric(tab.id, m)}
                      onActivity={(busy) => setBusy(tab.id, busy)}
                      onTitleChange={(title) => {
                        const clean = title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
                        if (clean) setActiveTabs(previous => previous.map(item => item.id === tab.id ? { ...item, name: clean } : item))
                      }}
                      onCwdChange={(cwd) => setSessionCwd(tab.id, cwd)}
                      // A run-to-completion pane has nothing left once its shell exits, so it takes its
                      // own tab with it (see sessionExit.ts). skipConfirm: the session is already gone.
                      // Renew kills this process on purpose; that exit must not close the tab.
                      onExit={(code) => { if (!isRenewing(tab.id) && closesOnExit(conn, code)) closeTabs([tab.id], true) }}
                      theme={appSettings.darkMode ? terminalTheme.terminal.dark : terminalTheme.terminal.light}
                      fontSize={terminalFontSize} smartColors={appSettings.smartColors}
                      onFontSizeChange={onFontSizeChange
                        ? (size) => onFontSizeChange(size - terminalFontSize, terminalTarget)
                        : undefined}
                      shortcuts={appSettings.shortcuts}
                      enterModes={resolveEnterModes(appSettings)}
                      fontFamilyMono={appSettings.darkMode ? terminalTheme.ui.dark.fontFamilyMono : terminalTheme.ui.light.fontFamilyMono}
                    />
                  )
                  return (
                    <div
                      key={tab.id}
                      onMouseDownCapture={() => { if (visible && sourcePaneIdx >= 0) setFocusedPane(sourcePaneIdx) }}
                      onDragOver={split ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                      onDrop={split ? (e) => { e.preventDefault(); onPaneDrop(e, paneIdx) } : undefined}
                      // `pane-offscreen`, not Tailwind's `hidden`: `display: none` destroys an
                      // xterm pane's scroll position and forces a re-fit on every tab switch — see the rule's own comment in index.css.
                      className={`absolute overflow-hidden ${visible ? '' : 'pane-offscreen'} ${split ? 'p-0.5' : ''} ${pulsePaneId === tab.id && visible ? 'pane-focus-pulse' : ''}`}
                      style={style}
                    >
                      <div
                        style={split && isFocused && !isDropTarget ? { borderColor: paneIdentity(paneIdx).color } : undefined}
                        className={`h-full w-full flex flex-col ${split ? `rounded-lg border ${
                          isDropTarget ? 'border-dashed border-theme-accent' : isFocused ? '' : 'border-theme-border'
                        }` : ''}`}
                      >
                        {visible && (split || conn) && renderPaneHeader(fullscreenTabId ? sourcePaneIdx : paneIdx, conn ?? null, !split)}
                        <QuotaPaneLines sessionId={tab.id} />
                        <div className={`flex-1 min-h-0 relative ${split && (layoutMode > 4 || !conn) ? 'rounded-b-lg ' : ''}overflow-hidden`}>
                          {sessionView}
                          <SuspendedOverlay sessionId={tab.id} />
                          <UsageProbeOverlay sessionId={tab.id} />
                          <PaneSessionOverlayHost
                            sessionId={tab.id}
                            onResumeCommand={(command, cwd) => requestNewSession(undefined, model.selectedWorkspaceId, cwd ?? null, command)}
                            onNewSession={() => { setFocusedPane(paneIdx); requestNewSession(undefined, model.selectedWorkspaceId) }}
                          />

                          {statuses[tab.id] === 'connecting' && !poppedOut[tab.id] && <ConnectingOverlay dark={appSettings.darkMode} customArtUrl={loadingArtUrl} />}
                        </div>
                        {split && conn && <PaneSessionFooter tab={tab} conn={conn} model={model} />}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
          </div>
        </div>
        {/* ── Connection form modal ────────────────────────────────────────── */}
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
        {blurOpen && blurAvailable && <BlurSettingsOverlay strength={appSettings.blurInactiveWindow ?? 0} blurDock={appSettings.blurInactiveDock ?? false} enabled={appSettings.blurEnabled ?? true} onSave={(blurInactiveWindow, blurInactiveDock, blurEnabled) => { const next = { ...appSettings, blurInactiveWindow, blurInactiveDock, blurEnabled }; setAppSettings(next); window.omnitermAPI.settings.save(next) }} onClose={() => setBlurOpen(false)} />}
    </div>)}
