import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'

import AgentQuotaSettings from '../../features/agent-quota/AgentQuotaSettings'
import { parseQuotaConfig } from '../../features/agent-quota/quotaConfig'
import { registerQuotaCommands, updateQuota } from '../../features/agent-quota/quotaStore'
import AlwaysAwakeModal from '../../features/always-awake/AlwaysAwakeModal'
import { formatDeadline } from '../../features/always-awake/awakeSchedule'
import { appLogo } from '../../assets/appLogo'
import { selectPage } from '../../ide/features/settings/model/staging'
import { useSettingsPages } from '../../ide/workbench/contributions'
import CustomArtSettings from '../../components/CustomArtSettings'
import EditorShortcutsSettings from '../../components/EditorShortcutsSettings'
import GeneralSettings, { type GeneralSettingsSection } from '../../components/GeneralSettings'
import PluginManager from '../../components/PluginManager'
import UpdateSettings from '../../components/UpdateSettings'
import { diag } from '../../diag'
import { useCustomArt } from '../../hooks/useCustomArt'
import { useUpdateActions } from '../../hooks/useUpdateActions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { loadShellOptions, type ShellOption } from '../../shellOptions'

import { notifyCustomArtChanged } from './customArtSync'
import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'
import { TerminalCtrlCForm } from './TerminalCtrlCForm'
import { useAppSettings } from './useAppSettings'
import { useDialogHost } from './useDialogHost'

const noop = () => {}

/** One feature's part of the app preferences (the sections of `GeneralSettings`). */
function GeneralSettingsPage({ sections }: { sections: readonly GeneralSettingsSection[] }) {
  const { appSettings, setAppSettings } = useAppSettings()
  const { showAlert, host } = useDialogHost()
  if (!appSettings) return null
  return (
    <>
      <GeneralSettings
        appSettings={appSettings}
        setAppSettings={setAppSettings}
        shellOptions={[]}
        showAlert={showAlert}
        onCloseSettings={noop}
        sections={sections}
      />
      {host}
    </>
  )
}

/** Settings › Agents › Agent Sessions: what renewing an agent session does. */
export function AgentSessionsPage() {
  return <GeneralSettingsPage sections={['agents']} />
}

/** Settings › Version Control › Git Utilities: the Activity Bar Git button and branch indicator. */
export function GitUtilitiesPage() {
  return <GeneralSettingsPage sections={['git']} />
}

/** Settings › Editor › Files & Attachments: the file viewer's limits and large pastes. */
export function FilesPage() {
  return <GeneralSettingsPage sections={['files']} />
}

/** Settings › Appearance & Behavior › System Settings › Backup & Restore. */
export function BackupPage() {
  return <GeneralSettingsPage sections={['backup']} />
}

/** Settings › Terminal: Ctrl+C rules, the default shell and workspace, completion and close prompts. */
export function TerminalPage() {
  const { appSettings, setAppSettings, patch } = useAppSettings()
  const { showAlert, host } = useDialogHost()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const refreshWorkspaces = useWorkspaceStore((s) => s.refresh)
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([])
  useEffect(() => {
    void refreshWorkspaces()
    void loadShellOptions().then(setShellOptions).catch((error: unknown) => diag.warn('[settings] shell list failed', error))
  }, [refreshWorkspaces])
  if (!appSettings) return null
  return (
    <>
      <TerminalCtrlCForm value={appSettings.terminalCtrlC} onChange={(terminalCtrlC) => patch({ terminalCtrlC })} />
      <GeneralSettings
        appSettings={appSettings}
        setAppSettings={setAppSettings}
        shellOptions={shellOptions}
        workspaces={workspaces}
        showAlert={showAlert}
        onCloseSettings={noop}
        sections={['terminal']}
      />
      {host}
    </>
  )
}

/** Settings › Appearance › Artwork. */
export function ArtworkPage() {
  const { appSettings } = useAppSettings()
  const art = useCustomArt(!!appSettings?.darkMode)
  if (!appSettings) return null
  return (
    <div className="p-2">
      <CustomArtSettings
        idleArtUrlLight={art.idleArtUrlLight}
        idleArtUrlDark={art.idleArtUrlDark}
        loadingArtUrlLight={art.loadingArtUrlLight}
        loadingArtUrlDark={art.loadingArtUrlDark}
        onArtChanged={() => { art.refreshCustomArt(); notifyCustomArtChanged() }}
      />
    </div>
  )
}

/** Settings › Keymap › Editor Shortcuts (the terminal's file viewer/editor). */
export function EditorShortcutsPage() {
  const { appSettings, setAppSettings } = useAppSettings()
  const { showAlert, host } = useDialogHost()
  if (!appSettings) return null
  return (
    <>
      <EditorShortcutsSettings appSettings={appSettings} setAppSettings={setAppSettings} showAlert={showAlert} />
      {host}
    </>
  )
}

/** The settings page of each bundled plugin that has one (shown as its card's Configure link). */
const PLUGIN_SETTINGS_PAGES: Readonly<Record<string, string>> = {
  'omniterm.agent-quota': OMNITERM_SETTINGS_PAGES.agentQuota,
  'omniterm.always-awake': OMNITERM_SETTINGS_PAGES.alwaysAwake,
}

/**
 * Settings › Plugins › Installed (and the Plugins dialog's OmniTerm tab): OmniTerm's built-in
 * features, one card each. `openPage` shows a plugin's settings page; inside Settings it selects it.
 */
export function BuiltinPluginsPage({
  openPage = selectPage,
  onlyPluginId,
}: {
  openPage?: (page: string) => void
  /** Show just this plugin (the Plugins dialog's details pane). */
  onlyPluginId?: string
}) {
  const { showAlert, showConfirm, host } = useDialogHost()
  const pages = useSettingsPages((s) => s.pages)
  const configureAction = (pluginId: string) => {
    const page = PLUGIN_SETTINGS_PAGES[pluginId]
    return page && pages.has(page) ? () => openPage(page) : undefined
  }
  return (
    <>
      <PluginManager
        showAlert={showAlert}
        showConfirm={showConfirm}
        configureAction={configureAction}
        onlyPluginId={onlyPluginId}
      />
      {host}
    </>
  )
}

/** Settings › Agents › Agent Quota. The engine runs in the main window; this edits its stored config. */
export function AgentQuotaPage() {
  const { appSettings } = useAppSettings()
  const raw = appSettings?.agentQuota
  useEffect(() => {
    updateQuota((state) => ({ ...state, available: true }))
    return registerQuotaCommands({
      saveConfig: (config) => {
        void Promise.resolve(window.omnitermAPI.settings.save({ agentQuota: config }))
          .catch((error: unknown) => diag.error('[settings] could not save the quota config', error))
      },
    })
  }, [])
  useEffect(() => {
    if (appSettings) updateQuota((state) => ({ ...state, config: parseQuotaConfig(raw) }))
  }, [appSettings, raw])
  if (!appSettings) return null
  return <AgentQuotaSettings refreshCustomArt={notifyCustomArtChanged} />
}

/** Settings › Agents › Always Awake. */
export function AlwaysAwakePage() {
  const [status, setStatus] = useState<AlwaysAwakeStatus | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    void window.omnitermAPI.alwaysAwake.getState().then(setStatus).catch(diag.error)
    return window.omnitermAPI.alwaysAwake.onState(setStatus)
  }, [])
  if (!status) return null
  const summary = !status.supported
    ? 'Not supported on this system.'
    : status.enabled
      ? `On (${status.mode === 'always' ? 'always' : 'only while sessions are active'}) until ${formatDeadline(status.expiresAtMs)}.`
      : 'Off. The computer may sleep as usual.'
  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] text-theme-dim leading-relaxed">
        Keeps this computer awake so long-running agent sessions are not interrupted by sleep.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-theme-border/60 bg-theme-bg/30 p-4">
        <span className="text-xs text-theme-fg">{summary}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-3 py-1 text-[11px] text-theme-fg bg-theme-bg border border-theme-border rounded-lg hover:text-theme-accent transition-colors"
        >
          Configure…
        </button>
      </div>
      {status.error && (
        <p className="flex items-center gap-1.5 text-[11px] text-theme-error"><AlertTriangle className="w-3 h-3" />{status.error}</p>
      )}
      {editing && <AlwaysAwakeModal status={status} onClose={() => setEditing(false)} onSaved={setStatus} />}
    </div>
  )
}

/** Settings › System Settings › About & Updates. */
export function AboutPage() {
  const { appSettings, setAppSettings } = useAppSettings()
  const { showAlert, host } = useDialogHost()
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const actions = useUpdateActions({ updateState, setUpdateState, showAlert })
  useEffect(() => {
    void window.omnitermAPI.updates.state().then(setUpdateState).catch(diag.error)
    return window.omnitermAPI.updates.onState(setUpdateState)
  }, [])
  if (!appSettings) return null
  return (
    <div className="p-4 flex flex-col gap-4">
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
            A local terminal and project workspace. Nothing leaves this machine unless you connect it somewhere.
          </p>
        </div>
      </div>
      <UpdateSettings
        appSettings={appSettings}
        setAppSettings={setAppSettings}
        updateState={updateState}
        updateChecking={actions.updateChecking}
        installerChoiceOpen={actions.installerChoiceOpen}
        setInstallerChoiceOpen={actions.setInstallerChoiceOpen}
        checkForUpdates={actions.checkForUpdates}
        skipThisVersion={actions.skipThisVersion}
        clearSkippedVersion={actions.clearSkippedVersion}
        handleDownloadPortable={actions.handleDownloadPortable}
        handleDownloadInstaller={actions.handleDownloadInstaller}
      />
      {host}
    </div>
  )
}
