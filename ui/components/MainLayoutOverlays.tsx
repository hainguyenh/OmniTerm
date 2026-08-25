import { Suspense, lazy } from 'react'
import { ArrowLeft, ArrowRight, Trash2, X, XCircle } from 'lucide-react'
import CloseConfirmModal from './CloseConfirmModal'
import { CommandPalette } from './CommandPalette'
import DialogHost from './DialogHost'
import NewTerminalMenu from './NewTerminalMenu'
import SettingsModal from './SettingsModal'
// Plugin contribution: split out of the entry chunk so a build without the Always Awake plugin never
// parses it — the overlay is only ever mounted once the plugin has answered `alwaysAwake.info`.
const AlwaysAwakeModal = lazy(() => import('../../plugins/always-awake/app/AlwaysAwakeModal'))
import { CtxItem } from './mainLayoutShared'
import { pickShell } from '../shellOptions'
import type { MainLayoutModel } from './useMainLayoutController'

export default function MainLayoutOverlays({ model }: { model: MainLayoutModel }) {
  const { appSettings, setAppSettings, updateState, hasConnectionProvider, setHasConnectionProvider, setConnectionCapabilities, activeTabs, savedConnections, tabMenu, setTabMenu, shellMenu, setShellMenu, pendingCloseTabIds, setPendingCloseTabIds, skipCloseConfirmRef, recordingAction, setRecordingAction, dialogState, showAlert, showConfirm, commandPaletteOpen, setCommandPaletteOpen, aboutOpen, setAboutOpen, updateChecking, installerChoiceOpen, setInstallerChoiceOpen, shellOptions, workspaces = [], selectedWorkspaceId = null, setSelectedWorkspaceId = () => {}, requestNewSession, checkForUpdates, handleDownloadPortable, handleDownloadInstaller, skipThisVersion, clearSkippedVersion, handleConnect, closeTabs, closeTab, refreshCustomArt, idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark, alwaysAwake, setAlwaysAwake, alwaysAwakeOpen, setAlwaysAwakeOpen } = model
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
            workspaces={workspaces}
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
    
          {shellMenu && (
            <NewTerminalMenu
              anchor={shellMenu}
              shellOptions={shellOptions}
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              defaultShellId={pickShell(shellOptions, appSettings.defaultShell)}
              onSelectWorkspace={setSelectedWorkspaceId}
              onLaunchShell={(shell, workspaceSelection) => {
                // A folder row's Enter names its folder explicitly (null = default directory);
                // a plain shell launch follows the menu's current workspace choice.
                if (workspaceSelection !== undefined) requestNewSession(shell, workspaceSelection)
                else if (selectedWorkspaceId) requestNewSession(shell, selectedWorkspaceId)
                else requestNewSession(shell)
              }}
              onClose={() => setShellMenu(null)}
            />
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
