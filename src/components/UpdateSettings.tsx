/**
 * UpdateSettings — the Settings dialog's "Updates" section.
 *
 * Opt-in update checking: the current state, the download/install actions, skipping a version, and the
 * startup-check toggle. Nothing here contacts a server until the user asks.
 *
 * This used to be `AdvancedSettings`, one half of an "Advanced" tab it shared with the encrypted vault
 * backup. That pairing was wrong: the backup only functions with a connection-manager plugin (it now
 * lives beside that plugin in PluginManager), while checking for updates is ordinary app settings and
 * belongs in plain sight under General. The tab itself is gone.
 *
 * Backend-agnostic on purpose: everything goes through `window.omnitermAPI`, which is the Electron
 * typed commands exposed by src/omnitermAPI.ts.
 */

import { AlertTriangle, Check, Download, Loader2, RotateCw, X } from 'lucide-react'

export interface UpdateSettingsProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  updateState: UpdateState | null
  updateChecking: boolean
  installerChoiceOpen: boolean
  setInstallerChoiceOpen: (v: boolean) => void
  checkForUpdates: () => void
  skipThisVersion: () => void
  clearSkippedVersion: () => void
  handleDownloadPortable: () => void
  handleDownloadInstaller: (installNow: boolean) => void
}

export default function UpdateSettings({
  appSettings,
  setAppSettings,
  updateState,
  updateChecking,
  installerChoiceOpen,
  setInstallerChoiceOpen,
  checkForUpdates,
  skipThisVersion,
  clearSkippedVersion,
  handleDownloadPortable,
  handleDownloadInstaller,
}: UpdateSettingsProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-t border-theme-border">
        <p className="text-[10px] uppercase font-bold tracking-widest text-theme-dim mb-1">Updates</p>
        <p className="text-[11px] text-theme-dim leading-relaxed">
          Opt-in only — OmniTerm never contacts a server for updates unless you ask it to here, or
          switch on the startup check below.
        </p>
      </div>

      {/* Update checker */}
      <div className="px-4 py-3 border-t border-theme-border">
        {updateState?.updateAvailable ? (
          <div className="rounded-xl bg-theme-accent/8 border border-[#9ece6a]/30 px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-theme-success flex-shrink-0" />
              <span className="text-xs font-semibold text-theme-success">
                Update available — v{updateState.latest}
              </span>
            </div>
            <p className="text-[11px] text-theme-fg leading-relaxed">
              You're on v{updateState.current}. {updateState.isPortable ? 'Download the portable update.' : 'Download the installer.'}
            </p>

            {updateState.downloadStatus && (
              <div className="text-[11px] text-[var(--theme-accent)] font-semibold bg-theme-bg px-2 py-1 rounded border border-theme-border animate-pulse">
                {updateState.downloadStatus}
              </div>
            )}

            {installerChoiceOpen ? (
              <div className="flex flex-col gap-2 p-2 bg-theme-bg rounded-lg border border-theme-border mt-1.5">
                <p className="text-[10px] text-theme-fg font-semibold">How would you like to install the update?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={updateChecking}
                    onClick={() => handleDownloadInstaller(true)}
                    className="flex-1 text-[11px] font-bold py-1.5 px-2 rounded-lg bg-theme-accent text-theme-accent-fg hover:bg-[#a8db75] disabled:opacity-60 transition-colors"
                  >
                    Install now
                  </button>
                  <button
                    type="button"
                    disabled={updateChecking}
                    onClick={() => handleDownloadInstaller(false)}
                    className="flex-1 text-[11px] font-bold py-1.5 px-2 rounded-lg border border-theme-border text-theme-fg hover:border-theme-accent disabled:opacity-60 transition-colors"
                  >
                    On exit
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  type="button"
                  disabled={updateChecking}
                  onClick={updateState.isPortable ? handleDownloadPortable : () => setInstallerChoiceOpen(true)}
                  className="relative flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-2.5 rounded-lg bg-theme-accent text-theme-accent-fg hover:bg-[#a8db75] disabled:opacity-60 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {updateState.isPortable ? 'Download update' : 'Install update'}
                  <span className="absolute -top-0.5 -right-0.5 block h-1.5 w-1.5 rounded-full bg-red-500 ring-1 ring-[#9ece6a]" />
                </button>
                <button
                  type="button"
                  disabled={updateChecking}
                  onClick={skipThisVersion}
                  title="Hide this update notification"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-2.5 rounded-lg border border-theme-border text-theme-fg hover:border-theme-accent hover:text-theme-accent disabled:opacity-60 transition-colors"
                >
                  Skip v{updateState.latest}
                </button>
              </div>
            )}
          </div>
        ) : updateState?.error ? (
          <div className="rounded-xl bg-theme-error/8 border border-[#f7768e]/30 px-3 py-2.5">
            <p className="text-[11px] text-theme-error leading-relaxed">
              Couldn't check for updates: {updateState.error}
            </p>
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={updateChecking}
              className="relative mt-2 inline-flex items-center gap-1.5 text-xs font-bold py-1.5 px-2.5 rounded-lg bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] disabled:opacity-60 transition-colors"
            >
              {updateChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              Retry
              {updateState?.hasNewerVersion && (
                <span className="absolute -top-0.5 -right-0.5 block h-1.5 w-1.5 rounded-full bg-theme-accent ring-1 ring-[var(--theme-popup-bg)]" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-theme-fg">
              {updateChecking ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin text-theme-accent" /><span className="text-xs">Checking…</span></>
              ) : updateState?.latest ? (
                <><Check className="w-3.5 h-3.5 text-theme-success" /><span className="text-xs">Up to date — v{updateState.current} (latest v{updateState.latest})</span></>
              ) : (
                <><AlertTriangle className="w-3.5 h-3.5 text-theme-dim" /><span className="text-xs text-theme-dim">Not checked yet</span></>
              )}
            </div>
            {updateState?.lastCheckAt && !updateChecking && (
              <p className="text-[10px] text-theme-dim">Last checked {new Date(updateState.lastCheckAt).toLocaleString()}</p>
            )}
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={updateChecking}
              className="relative inline-flex items-center gap-1.5 text-xs font-bold py-1.5 px-3 rounded-lg bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {updateChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              Check for updates
              {updateState?.hasNewerVersion && (
                <span className="absolute -top-0.5 -right-0.5 block h-1.5 w-1.5 rounded-full bg-theme-accent ring-1 ring-[var(--theme-popup-bg)]" />
              )}
            </button>
          </div>
        )}

        {/* Skipped-version control: only shown when a version is currently skipped */}
        {updateState?.skippedVersion && (
          <div className="mt-3 pt-3 border-t border-theme-border">
            <label className="text-[10px] text-theme-dim uppercase font-bold tracking-widest">Skipped version</label>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-xs text-theme-fg bg-theme-bg border border-theme-border rounded-lg py-1.5 px-2.5">
                <Check className="w-3.5 h-3.5 text-theme-success flex-shrink-0" />
                Skipping v{updateState.skippedVersion}
              </span>
              <button
                type="button"
                onClick={clearSkippedVersion}
                title="Clear skipped version — get notified again"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-theme-bg border border-theme-border text-theme-error hover:border-[#f7768e] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Startup Check Control */}
        <div className="mt-3 pt-3 border-t border-theme-border">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] text-theme-dim uppercase font-bold tracking-widest"
              title="Automatically check GitHub for a newer release when the app starts"
            >Check on startup</span>
            <button
              type="button"
              onClick={() => {
                const next = { ...appSettings, checkUpdatesOnStartup: !appSettings.checkUpdatesOnStartup }
                setAppSettings(next)
                window.omnitermAPI.settings.save(next)
              }}
              className={`w-14 h-6 rounded-lg border text-[11px] font-bold transition-colors ${
                appSettings.checkUpdatesOnStartup
                  ? 'bg-theme-accent/15 border-theme-accent text-theme-accent'
                  : 'bg-theme-bg border-theme-border text-theme-dim hover:text-theme-fg'
              }`}
            >{appSettings.checkUpdatesOnStartup ? 'ON' : 'OFF'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
