import { Suspense, lazy } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Terminal, Trash2, X, XCircle } from 'lucide-react'
import CloseConfirmModal from './CloseConfirmModal'
import { CommandPalette } from './CommandPalette'
import DialogHost from './DialogHost'
import SettingsModal from './SettingsModal'
// Plugin contribution: split out of the entry chunk so a build without the Always Awake plugin never
// parses it — the overlay is only ever mounted once the plugin has answered `alwaysAwake.info`.
const AlwaysAwakeModal = lazy(() => import('../../plugins/always-awake/app/AlwaysAwakeModal'))
import { CtxItem } from './mainLayoutShared'
import type { MainLayoutModel } from './useMainLayoutController'
import { orderedWorkspaceRows } from '../utils/workspaceHierarchy'
import { decodeWorkspaceSelection, encodeWorkspaceSelection } from '../utils/workspaceSelection'

export default function MainLayoutOverlays({ model }: { model: MainLayoutModel }) {
  const { appSettings, setAppSettings, updateState, hasConnectionProvider, setHasConnectionProvider, setConnectionCapabilities, activeTabs, savedConnections, tabMenu, setTabMenu, shellMenu, setShellMenu, pendingCloseTabIds, setPendingCloseTabIds, skipCloseConfirmRef, recordingAction, setRecordingAction, dialogState, showAlert, showConfirm, commandPaletteOpen, setCommandPaletteOpen, aboutOpen, setAboutOpen, updateChecking, installerChoiceOpen, setInstallerChoiceOpen, shellOptions, workspaces = [], selectedWorkspaceId = null, setSelectedWorkspaceId = () => {}, requestNewSession, checkForUpdates, handleDownloadPortable, handleDownloadInstaller, skipThisVersion, clearSkippedVersion, handleConnect, closeTabs, closeTab, refreshCustomArt, idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark, alwaysAwake, setAlwaysAwake, alwaysAwakeOpen, setAlwaysAwakeOpen } = model
  const terminalSelection = decodeWorkspaceSelection(selectedWorkspaceId)
  const terminalWorkspaces = orderedWorkspaceRows(workspaces).filter(row => row.workspace.folders.length > 0)
  const shellMenuAbove = shellMenu !== null && shellMenu.y > window.innerHeight / 2
  const shellMenuStyle = shellMenu ? {
    left: Math.min(Math.max(shellMenu.x, 8), Math.max(8, window.innerWidth - 176)),
    ...(shellMenuAbove
      ? { bottom: window.innerHeight - shellMenu.y + 8 }
      : { top: Math.min(shellMenu.y, window.innerHeight - 8) }),
    maxHeight: shellMenuAbove
      ? Math.max(48, window.innerHeight - 16)
      : Math.max(48, window.innerHeight - shellMenu.y - 8),
  } : undefined
  return (
    <>
          {alwaysAwakeOpen && (
            <Suspense fallback={null}>
              <AlwaysAwakeModal
                status={alwaysAwake}
                onClose={() => setAlwaysAwakeOpen(false)}
                onSaved={setAlwaysAwake}
              />
            </Suspense>
          )}

          <SettingsModal
            isOpen={aboutOpen}
            onClose={() => setAboutOpen(false)}
            appSettings={appSettings}
            setAppSettings={setAppSettings}
            shellOptions={shellOptions}
            activeSessionCount={activeTabs.length}
            hasConnectionProvider={hasConnectionProvider}
            setHasConnectionProvider={setHasConnectionProvider}
            setConnectionCapabilities={setConnectionCapabilities}
            showAlert={showAlert}
            showConfirm={showConfirm}
            updateState={updateState}
            updateChecking={updateChecking}
            installerChoiceOpen={installerChoiceOpen}
            setInstallerChoiceOpen={setInstallerChoiceOpen}
            checkForUpdates={checkForUpdates}
            skipThisVersion={skipThisVersion}
            clearSkippedVersion={clearSkippedVersion}
            handleDownloadPortable={handleDownloadPortable}
            handleDownloadInstaller={handleDownloadInstaller}
            recordingAction={recordingAction}
            setRecordingAction={setRecordingAction}
            idleArtUrlLight={idleArtUrlLight}
            idleArtUrlDark={idleArtUrlDark}
            loadingArtUrlLight={loadingArtUrlLight}
            loadingArtUrlDark={loadingArtUrlDark}
            refreshCustomArt={refreshCustomArt}
          />
    
    
    
          {tabMenu && (
            <div 
              className="fixed inset-0 z-50"
              onClick={() => setTabMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setTabMenu(null) }}
            >
              <div 
                className="absolute bg-theme-popup border border-theme-border rounded-lg shadow-xl py-1 min-w-[160px] text-xs font-medium"
                style={{ left: tabMenu.x, top: tabMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <CtxItem label="Close" icon={<X className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => { closeTab(tabMenu.tabId); setTabMenu(null) }} />
                <CtxItem label="Close Others" icon={<XCircle className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
                  closeTabs(activeTabs.filter(t => t.id !== tabMenu.tabId).map(t => t.id))
                  setTabMenu(null)
                }} />
                <CtxItem label="Close to the Left" icon={<ArrowLeft className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
                  const idx = activeTabs.findIndex(t => t.id === tabMenu.tabId)
                  if (idx > 0) closeTabs(activeTabs.slice(0, idx).map(t => t.id))
                  setTabMenu(null)
                }} />
                <CtxItem label="Close to the Right" icon={<ArrowRight className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
                  const idx = activeTabs.findIndex(t => t.id === tabMenu.tabId)
                  if (idx !== -1 && idx < activeTabs.length - 1) closeTabs(activeTabs.slice(idx + 1).map(t => t.id))
                  setTabMenu(null)
                }} />
                <div className="h-px bg-theme-border my-1 mx-2" />
                <CtxItem label="Close All" icon={<Trash2 className="w-3.5 h-3.5" />} color="text-theme-error" onClick={() => {
                  closeTabs(activeTabs.map(t => t.id))
                  setTabMenu(null)
                }} />
              </div>
            </div>
          )}
    
          {shellMenu && createPortal(
            <div 
              className="fixed inset-0 z-50"
              data-testid="shell-menu-backdrop"
              onClick={() => setShellMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setShellMenu(null) }}
            >
              <div 
                className="absolute max-w-[calc(100vw-1rem)] overflow-y-auto custom-scrollbar bg-theme-popup border border-theme-border rounded-lg shadow-xl py-1 min-w-[160px] text-xs font-medium"
                style={shellMenuStyle}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-theme-dim">Workspace</div>
                <CtxItem label="None (default directory)" icon={<Terminal className="w-3.5 h-3.5" />} color={selectedWorkspaceId === null ? 'text-theme-accent' : 'text-theme-fg'} onClick={() => setSelectedWorkspaceId(null)} />
                {terminalWorkspaces.flatMap(({ workspace, depth }) => workspace.folders.map(folder => {
                  const selection = encodeWorkspaceSelection(workspace.id, folder.id)
                  return (
                    <CtxItem key={selection} label={`${'· '.repeat(depth)}${workspace.name} - ${folder.name}`} icon={<Terminal className="w-3.5 h-3.5" />} color={selection === selectedWorkspaceId ? 'text-theme-accent' : 'text-theme-fg'} onClick={() => { setSelectedWorkspaceId(selection); setShellMenu(null) }} />
                  )
                }))}
                {workspaces.some(workspace => workspace.folders.length === 0) && (
                  <div className="px-3 py-1 text-[10px] text-theme-dim">Add a folder before opening a terminal.</div>
                )}
                <div className="h-px bg-theme-border my-1 mx-2" />
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-theme-dim">Shell</div>
                {/* Only shells the backend can really start. The old hardcoded list included "Git Bash",
                    which is not a LocalShell — clicking it failed with nothing shown to the user. */}
                {shellOptions.map(opt => (
                  <CtxItem key={opt.id} label={opt.label} icon={<Terminal className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => { terminalSelection ? requestNewSession(opt.id, selectedWorkspaceId) : requestNewSession(opt.id); setShellMenu(null) }} />
                ))}
              </div>
            </div>, document.body
          )}
    
          {pendingCloseTabIds && (
            <CloseConfirmModal 
              isMultiple={pendingCloseTabIds.length > 1}
              onCancel={() => setPendingCloseTabIds(null)}
              onConfirm={(applyToAll) => {
                if (applyToAll) skipCloseConfirmRef.current = true
                closeTabs(pendingCloseTabIds, true)
                setPendingCloseTabIds(null)
              }}
            />
          )}
    
          {/* ── Custom themed dialog host (replaces window.alert / window.confirm) ── */}
          <DialogHost dialogState={dialogState} />
          
          <CommandPalette 
            isOpen={commandPaletteOpen} 
            onClose={() => setCommandPaletteOpen(false)} 
            connections={savedConnections}
            onConnect={(conn) => handleConnect(conn)} 
          />
    </>
  )
}
