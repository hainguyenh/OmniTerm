import React, { useState } from 'react'
import { Info, Keyboard, Package, Palette, RotateCcw, Sliders, X } from 'lucide-react'
import type { ConnectionProviderCapabilities, Workspace } from '@omniterm/contract'
import type { UseDialogReturn } from '../hooks/useDialog'
import GeneralSettings from './GeneralSettings'
import PluginManager from './PluginManager'
import CustomArtSettings from './CustomArtSettings'
import UpdateSettings from './UpdateSettings'
import { Tooltip } from './Tooltip'
import { KeycapCombo } from './Keycap'
import { appLogo } from '../assets/appLogo'
import { diag } from '../diag'
import { DEFAULT_SHORTCUTS, shortcutLabels } from './mainLayoutShared'
import type { ShellOption } from '../shellOptions'

export type SettingsTabId = 'general' | 'shortcuts' | 'plugins' | 'artwork' | 'about'

export interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  appSettings: AppSettings
  setAppSettings: (settings: AppSettings) => void
  shellOptions: ShellOption[]
  /** Workspace catalog for the "default workspace for new terminals" setting. */
  workspaces?: Workspace[]
  activeSessionCount: number
  hasConnectionProvider: boolean
  setHasConnectionProvider: (active: boolean) => void
  setConnectionCapabilities: (caps: ConnectionProviderCapabilities | null) => void
  showAlert: UseDialogReturn['showAlert']
  showConfirm: UseDialogReturn['showConfirm']
  updateState: UpdateState | null
  updateChecking: boolean
  installerChoiceOpen: boolean
  setInstallerChoiceOpen: (open: boolean) => void
  checkForUpdates: () => void
  skipThisVersion: () => void
  clearSkippedVersion: () => void
  handleDownloadPortable: () => void
  handleDownloadInstaller: (installNow: boolean) => void
  recordingAction: string | null
  setRecordingAction: (action: string | null) => void
  idleArtUrlLight?: string | null
  idleArtUrlDark?: string | null
  loadingArtUrlLight?: string | null
  loadingArtUrlDark?: string | null
  refreshCustomArt?: () => void
}

const TABS: Array<{ id: SettingsTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'plugins', label: 'Plugins', icon: Package },
  { id: 'artwork', label: 'Artwork', icon: Palette },
  { id: 'about', label: 'About & Updates', icon: Info },
]

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appSettings,
  setAppSettings,
  shellOptions,
  workspaces = [],
  activeSessionCount,
  hasConnectionProvider,
  setHasConnectionProvider,
  setConnectionCapabilities,
  showAlert,
  showConfirm,
  updateState,
  updateChecking,
  installerChoiceOpen,
  setInstallerChoiceOpen,
  checkForUpdates,
  skipThisVersion,
  clearSkippedVersion,
  handleDownloadPortable,
  handleDownloadInstaller,
  recordingAction,
  setRecordingAction,
  idleArtUrlLight,
  idleArtUrlDark,
  loadingArtUrlLight,
  loadingArtUrlDark,
  refreshCustomArt,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')

  if (!isOpen) return null

  const handleResetShortcuts = () => {
    setAppSettings({ ...appSettings, shortcuts: { ...DEFAULT_SHORTCUTS } })
    window.omnitermAPI.settings.save({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-3xl bg-theme-popup rounded-2xl border border-theme-border shadow-2xl overflow-hidden flex flex-col h-[580px] max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-theme-border bg-theme-bg/40">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-theme-fg tracking-widest uppercase">Settings</span>
            <span className="text-[10px] text-theme-dim uppercase font-semibold px-2 py-0.5 rounded-full bg-black/10 border border-theme-border">
              {TABS.find((t) => t.id === activeTab)?.label}
            </span>
          </div>
          <Tooltip content="Close settings" shortcut="Esc" placement="left">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="p-1 rounded-lg text-theme-dim hover:text-theme-error hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* Main layout: Sidebar + Content */}
        <div className="flex flex-1 min-h-0 divide-x divide-theme-border">
          {/* Navigation Sidebar */}
          <nav className="w-44 flex-shrink-0 p-2.5 flex flex-col gap-1 bg-theme-bg/20 overflow-y-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[var(--theme-accent)] text-theme-accent-fg font-semibold shadow-sm'
                      : 'text-theme-fg opacity-75 hover:opacity-100 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Content View */}
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar flex flex-col">
            {activeTab === 'general' && (
              <GeneralSettings
                appSettings={appSettings}
                setAppSettings={setAppSettings}
                shellOptions={shellOptions}
                workspaces={workspaces}
                showAlert={showAlert}
                onCloseSettings={onClose}
              />
            )}

            {activeTab === 'shortcuts' && (
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">Keyboard Shortcuts</h3>
                    <p className="text-[11px] text-theme-dim leading-relaxed mt-0.5">
                      Click a binding to record a new shortcut. Modifiers will combine automatically.
                    </p>
                  </div>
                  <Tooltip content="Reset all shortcuts to default bindings" placement="bottom">
                    <button
                      type="button"
                      onClick={handleResetShortcuts}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-dim hover:text-theme-accent bg-theme-bg border border-theme-border rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </Tooltip>
                </div>

                <div className="flex flex-col gap-1.5 border-t border-theme-border pt-3">
                  {(Object.keys(shortcutLabels) as Array<keyof ShortcutBindings>).map((key) => {
                    const label = shortcutLabels[key]
                    const currentBinding = appSettings.shortcuts?.[key] ?? DEFAULT_SHORTCUTS[key] ?? 'None'
                    const isRecording = recordingAction === key

                    return (
                      <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 border-b border-theme-border/20">
                        <span className="text-xs text-theme-fg font-medium">{label}</span>
                        <div className="flex items-center gap-2">
                          {!isRecording && currentBinding !== 'None' && (
                            <KeycapCombo shortcut={currentBinding} />
                          )}
                          <Tooltip content={isRecording ? 'Press keys or click to cancel' : 'Click to record new shortcut'} placement="left">
                            <button
                              type="button"
                              onClick={() => setRecordingAction(isRecording ? null : key)}
                              className={`min-w-[70px] text-center text-[10px] font-mono font-bold py-1 px-2 rounded-lg border transition-all ${
                                isRecording
                                  ? 'bg-[var(--theme-accent)] text-theme-accent-fg border-[var(--theme-accent)] animate-pulse'
                                  : 'bg-theme-bg border-theme-border text-theme-dim hover:text-theme-accent hover:border-theme-accent'
                              }`}
                            >
                              {isRecording ? 'Record…' : 'Edit'}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="p-2">
                <PluginManager
                  activeSessionCount={activeSessionCount}
                  onProviderStatusChanged={(active) => {
                    setHasConnectionProvider(active)
                    window.omnitermAPI.plugin
                      .connectionCapabilities()
                      .then(setConnectionCapabilities)
                      .catch(diag.error)
                  }}
                  showAlert={showAlert}
                  showConfirm={showConfirm}
                />
              </div>
            )}

            {activeTab === 'artwork' && (
              <div className="p-2">
                <CustomArtSettings
                  idleArtUrlLight={idleArtUrlLight ?? null}
                  idleArtUrlDark={idleArtUrlDark ?? null}
                  loadingArtUrlLight={loadingArtUrlLight ?? null}
                  loadingArtUrlDark={loadingArtUrlDark ?? null}
                  onArtChanged={refreshCustomArt ?? (() => {})}
                />
              </div>
            )}

            {activeTab === 'about' && (
              <div className="p-4 flex flex-col gap-4">
                {/* Branding Banner */}
                <div className="flex items-center gap-3.5 p-4 rounded-xl bg-theme-bg/60 border border-theme-border">
                  <div className="w-12 h-12 rounded-xl overflow-hidden shadow-md border border-theme-border/40 flex-shrink-0">
                    <img src={appLogo} alt="OmniTerm" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-theme-fg tracking-tight">OmniTerm</h2>
                      <span className="text-[10px] font-mono text-theme-dim bg-theme-bg px-2 py-0.5 rounded-full border border-theme-border">
                        v{updateState?.current ?? '…'}
                      </span>
                    </div>
                    <p className="text-[11px] text-theme-dim leading-relaxed">
                      {hasConnectionProvider
                        ? 'Local terminals and optional remote connections. Nothing leaves this machine unless you connect it somewhere.'
                        : 'A plugin-free local terminal and project workspace. Install and select a connection provider to add SSH or RDP.'}
                    </p>
                  </div>
                </div>

                {/* Updates */}
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
