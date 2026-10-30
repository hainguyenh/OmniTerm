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

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, Loader2, RotateCw, X } from 'lucide-react'
import { Tooltip } from './Tooltip'

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
  checkForUpdates,
  skipThisVersion,
  clearSkippedVersion,
  handleDownloadPortable,
  handleDownloadInstaller,
}: UpdateSettingsProps) {
  // Native signed-update path: probed once. Unsigned/dev builds answer "updater-disabled" and the
  // manual download flow below stays the only path, exactly as before.
  const [nativeReady, setNativeReady] = useState(false)
  const [nativeInstalling, setNativeInstalling] = useState(false)
  const [nativeError, setNativeError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.omnitermAPI?.updates?.nativeCheck?.()
      .then((r) => { if (alive) setNativeReady(r.available === true) })
      .catch(() => { if (alive) setNativeReady(false) })
    return () => { alive = false }
  }, [])
  const runNativeInstall = async () => {
    setNativeInstalling(true)
    try {
      setNativeError(null)
      await window.omnitermAPI.updates.nativeInstall()
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error))
    } finally { setNativeInstalling(false) }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">Application Updates</h3>
          <p className="max-w-[42ch] text-[11px] text-theme-dim mt-0.5 leading-relaxed">
            Opt-in only — OmniTerm never contacts a server for updates unless you ask it to here, or switch on the startup check below.
          </p>
        </div>
        {updateState?.updateAvailable && (
          <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-theme-success px-2 py-0.5 rounded-full border border-[#9ece6a]/30 bg-[#9ece6a]/10 flex-shrink-0">
            <span className="block h-1.5 w-1.5 rounded-full bg-theme-success" />
            v{updateState.latest} available
          </span>
        )}
      </div>

      <div className="border-t border-theme-border pt-2">
          {updateState?.updateAvailable ? (
            <div className="rounded-xl bg-theme-accent/8 border border-[#9ece6a]/30 px-3 py-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-theme-success flex-shrink-0" />
                <span className="text-xs font-semibold text-theme-success">
                  Update available — v{updateState.latest}
                </span>
              </div>
              <p className="text-[11px] text-theme-fg leading-relaxed">
                You're on v{updateState.current}. Downloads are sourced from the published GitHub release.
              </p>

              {updateState.downloadStatus && (
                <div className="text-[11px] text-[var(--theme-accent)] font-semibold bg-theme-bg px-2 py-1 rounded border border-theme-border animate-pulse">
                  {updateState.downloadStatus}
                </div>
              )}

              {nativeError && <p role="alert" className="max-w-[45ch] text-[11px] text-theme-error">{nativeError}</p>}
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                {nativeReady && (
                  <Tooltip content="Install the signed update and relaunch OmniTerm" placement="bottom">
                    <button
                      type="button"
                      disabled={nativeInstalling || updateChecking}
                      onClick={() => void runNativeInstall()}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg bg-theme-accent text-theme-accent-fg disabled:opacity-60"
                    >
                      {nativeInstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      Download & install
                    </button>
                  </Tooltip>
                )}
                {updateState.installerAssetUrl && (
                  <Tooltip content="Open the official installer download in your browser" placement="bottom">
                    <button
                      type="button"
                      disabled={updateChecking || nativeInstalling}
                      onClick={() => handleDownloadInstaller(false)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg border border-theme-border text-theme-fg hover:border-theme-accent disabled:opacity-60"
                    >
                      <Download className="w-3 h-3" />
                      Download installer
                    </button>
                  </Tooltip>
                )}
                {updateState.portableAssetUrl && (
                  <Tooltip content="Open the official portable download in your browser" placement="bottom">
                    <button
                      type="button"
                      disabled={updateChecking || nativeInstalling}
                      onClick={handleDownloadPortable}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg border border-theme-border text-theme-fg hover:border-theme-accent disabled:opacity-60"
                    >
                      <Download className="w-3 h-3" />
                      Download portable
                    </button>
                  </Tooltip>
                )}
                <button
                  type="button"
                  onClick={() => void window.omnitermAPI.updates.openReleasePage()}
                  className="text-[11px] text-theme-accent underline underline-offset-2 hover:text-theme-fg"
                >
                  View on GitHub
                </button>
                <button
                  type="button"
                  onClick={skipThisVersion}
                  disabled={updateChecking || nativeInstalling}
                  className="text-[11px] text-theme-dim hover:text-theme-accent disabled:opacity-60"
                >
                  Skip v{updateState.latest}
                </button>
              </div>
              {!nativeReady && !updateState.installerAssetUrl && !updateState.portableAssetUrl && (
                <p className="max-w-[45ch] text-[11px] text-theme-dim">No platform download was attached to this release. Open its GitHub page to review the available files.</p>
              )}
            </div>
          ) : updateState?.error ? (
            <div className="rounded-xl bg-theme-error/8 border border-[#f7768e]/30 px-3 py-2.5">
              <p className="text-[11px] text-theme-error leading-relaxed">
                Couldn't check for updates: {updateState.error}
              </p>
              <Tooltip content="Retry update check" placement="bottom">
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
              </Tooltip>
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
              <Tooltip content="Check GitHub releases for updates" placement="bottom">
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
              </Tooltip>
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
                <Tooltip content="Clear skipped version — get notified again" placement="bottom">
                  <button
                    type="button"
                    onClick={clearSkippedVersion}
                    aria-label="Clear skipped version — get notified again"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-theme-bg border border-theme-border text-theme-error hover:border-[#f7768e] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
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
              <Tooltip content="Toggle automatic update checking when OmniTerm launches" placement="left">
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
                >
                  {appSettings.checkUpdatesOnStartup ? 'ON' : 'OFF'}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
  )
}
