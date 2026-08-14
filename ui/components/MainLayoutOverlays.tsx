import { Suspense, lazy } from 'react'
import { ArrowLeft, ArrowRight, Terminal, Trash2, X, XCircle } from 'lucide-react'
import CloseConfirmModal from './CloseConfirmModal'
import { CommandPalette } from './CommandPalette'
import DialogHost from './DialogHost'
import GeneralSettings from './GeneralSettings'
import PluginManager from './PluginManager'
import CustomArtSettings from './CustomArtSettings'
import UpdateSettings from './UpdateSettings'
import { appLogo } from '../assets/appLogo'
import { diag } from '../diag'
// Plugin contribution: split out of the entry chunk so a build without the Always Awake plugin never
// parses it — the overlay is only ever mounted once the plugin has answered `alwaysAwake.info`.
const AlwaysAwakeModal = lazy(() => import('../../plugins/always-awake/app/AlwaysAwakeModal'))
import { CtxItem, DEFAULT_SHORTCUTS, shortcutLabels } from './mainLayoutShared'
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
          {aboutOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={e => { if (e.target === e.currentTarget) setAboutOpen(false) }}
            >
              <div className="w-full max-w-2xl bg-theme-popup rounded-2xl border border-theme-border shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <span className="text-xs font-bold text-theme-fg tracking-widest uppercase">Settings</span>
                  <button onClick={() => setAboutOpen(false)} className="text-theme-dim hover:text-theme-error transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
    
                {/* Two-column container */}
                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#414868] h-[550px] max-h-[80vh]">
                  {/* Left Column: General Settings, Backup, and Updates */}
                  <div className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
                    <PluginManager
                      activeSessionCount={activeTabs.length}
                      onProviderStatusChanged={(active) => {
                        setHasConnectionProvider(active)
                        window.omnitermAPI.plugin.connectionCapabilities()
                          .then(setConnectionCapabilities)
                          .catch(diag.error)
                      }}
                      showAlert={showAlert}
                      showConfirm={showConfirm}
                    />
    
                    <GeneralSettings
                      appSettings={appSettings}
                      setAppSettings={setAppSettings}
                      shellOptions={shellOptions}
                      onCloseSettings={() => setAboutOpen(false)}
                    />

                    <CustomArtSettings
                      idleArtUrlLight={idleArtUrlLight}
                      idleArtUrlDark={idleArtUrlDark}
                      loadingArtUrlLight={loadingArtUrlLight}
                      loadingArtUrlDark={loadingArtUrlDark}
                      onArtChanged={refreshCustomArt}
                    />

                    {/* Branding */}
                    <div className="flex flex-col items-center gap-2 px-4 pb-1 pt-2.5 border-t border-theme-border">
                      <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg shadow-[#7aa2f7]/20">
                        <img src={appLogo} alt="OmniTerm" className="w-full h-full object-cover" />
                      </div>
                      <div className="text-center">
                        <h2 className="text-sm font-bold text-[var(--theme-fg)] tracking-tight">OmniTerm</h2>
                      </div>
                      <span className="text-[10px] text-[#414868] bg-theme-bg px-2 py-0.5 rounded-full border border-theme-border">
                        v{updateState?.current ?? '…'}
                      </span>
                    </div>
    
                    {/* Updates. This used to sit behind an "Advanced" tab alongside the encrypted vault
                        backup, which only works with a connection-manager plugin — the backup moved next
                        to the plugin it depends on, and checking for updates is plain app settings. */}
                    <UpdateSettings
                      appSettings={appSettings}
                      setAppSettings={setAppSettings}
                      updateState={updateState}
                      updateChecking={updateChecking}
                      installerChoiceOpen={installerChoiceOpen}
                      setInstallerChoiceOpen={setInstallerChoiceOpen}
                      checkForUpdates={checkForUpdates}
                      skipThisVersion={skipThisVersion}
                      clearSkippedVersion={clearSkippedVersion}
                      handleDownloadPortable={handleDownloadPortable}
                      handleDownloadInstaller={handleDownloadInstaller}
                    />
    
                    <div className="px-4 py-3 border-t border-theme-border">
                      <p className="text-[11px] text-theme-dim leading-relaxed">
                        {hasConnectionProvider
                          ? 'Local terminals and optional remote connections. Nothing leaves this machine unless you connect it somewhere.'
                          : 'A plugin-free local terminal and project workspace. Install and select a connection provider to add SSH or RDP.'}
                      </p>
                    </div>
                  </div>
    
                  {/* Right Column: Keyboard Shortcuts */}
                  <div className="flex-1 flex flex-col min-w-0 md:border-l border-theme-border">
                    <div className="px-4 py-3 border-t border-theme-border">
                      <p className="text-[10px] uppercase font-bold tracking-widest text-theme-dim mb-2">Keyboard Shortcuts</p>
                      <p className="text-[11px] text-theme-fg leading-relaxed">
                        Click a binding and press any keys to record a new shortcut. (Modifiers will combine automatically).
                      </p>
                    </div>
    
                    <div className="px-4 py-3 border-t border-theme-border flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-2 min-h-0">
                      {Object.entries(shortcutLabels).map(([key, label]) => {
                        const currentBinding = (appSettings.shortcuts as any)?.[key] || (DEFAULT_SHORTCUTS as any)?.[key] || 'None'
                        const isRecording = recordingAction === key
    
                        return (
                          <div key={key} className="flex items-center justify-between py-1.5 border-b border-theme-border/30">
                            <span className="text-xs text-theme-fg font-medium truncate pr-2">{label}</span>
                            <button
                              type="button"
                              onClick={() => setRecordingAction(isRecording ? null : key)}
                              className={`min-w-[90px] max-w-[140px] truncate text-center text-[10px] font-mono font-bold py-1.5 px-2 rounded-lg border transition-all ${
                                isRecording
                                  ? 'bg-[var(--theme-accent)] text-theme-accent-fg border-[var(--theme-accent)] animate-pulse'
                                  : 'bg-theme-bg border-theme-border text-[var(--theme-accent)] hover:border-[var(--theme-accent)] hover:bg-white/5'
                              }`}
                            >
                              {isRecording ? 'Record…' : currentBinding}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
    
    
    
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
            <div 
              className="fixed inset-0 z-50"
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
            </div>
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
