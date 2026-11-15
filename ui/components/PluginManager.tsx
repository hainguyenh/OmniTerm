import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseDialogReturn } from '../hooks/useDialog'
import { Button } from '../ide/ui'

import { PluginCard } from './PluginCard'
import { Tooltip } from './Tooltip'

interface PluginManagerProps {
  activeSessionCount: number
  onProviderStatusChanged(hasConnectionProvider: boolean): void
  showAlert: UseDialogReturn['showAlert']
  showConfirm: UseDialogReturn['showConfirm']
  /** The action that opens a plugin's settings page, when it has one. */
  configureAction?: (pluginId: string) => (() => void) | undefined
  /** Show only this plugin, without the list header (the Plugins dialog's details pane). */
  onlyPluginId?: string
}

export default function PluginManager({
  activeSessionCount,
  onProviderStatusChanged,
  showAlert,
  showConfirm,
  configureAction,
  onlyPluginId,
}: PluginManagerProps) {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<ConnectionProviderCapabilities | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)
  const providerStatusChangedRef = useRef(onProviderStatusChanged)
  providerStatusChangedRef.current = onProviderStatusChanged

  const refresh = useCallback(async () => {
    try {
      const ps = await window.omnitermAPI.plugin.list()
      setPlugins(ps)
      providerStatusChangedRef.current(ps.some(p => p.selectedConnectionProvider && p.enabled))
      setCapabilities(await window.omnitermAPI.plugin.connectionCapabilities())
    } catch (error) {
      await showAlert(
        `Could not load plugins: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    }
  }, [showAlert])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const installPackage = useCallback(async () => {
    setBusyId('__install__')
    try {
      const installed = await window.omnitermAPI.plugin.installPackage()
      if (!installed) return
      setRestartRequired(installed.restartRequired)
      await refresh()
      await showAlert(
        installed.restartRequired
          ? `“${installed.name}” ${installed.version} was installed. Restart OmniTerm to load the package safely.`
          : `“${installed.name}” ${installed.version} was installed and is ready to configure.`,
        { title: 'Plugin installed', tone: 'info' },
      )
    } catch (error) {
      await showAlert(
        `Could not install plugin: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    } finally {
      setBusyId(null)
    }
  }, [refresh, showAlert])

  const removePlugin = useCallback(async (plugin: PluginDescriptor) => {
    if (plugin.permissions.includes('connections') && activeSessionCount > 0) {
      await showAlert('Close all active sessions before removing a connection plugin.', {
        title: 'Plugin in use',
        tone: 'warning',
      })
      return
    }
    const confirmed = await showConfirm(
      `Remove “${plugin.name}” from this computer? Connection metadata is kept in plugin storage, but the plugin will no longer be available.`,
      { title: 'Remove plugin', confirmLabel: 'Remove', tone: 'warning' },
    )
    if (!confirmed) return
    setBusyId(plugin.id)
    try {
      await window.omnitermAPI.plugin.remove(plugin.id)
      await refresh()
    } catch (error) {
      await showAlert(
        `Could not remove plugin: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    } finally {
      setBusyId(null)
    }
  }, [activeSessionCount, refresh, showAlert, showConfirm])

  const restart = useCallback(async () => {
    if (activeSessionCount > 0) {
      await showAlert('Close all active sessions before restarting OmniTerm.', {
        title: 'Sessions are still running',
        tone: 'warning',
      })
      return
    }
    const confirmed = await showConfirm(
      'Restart OmniTerm now to finish applying plugin changes?',
      { title: 'Restart OmniTerm', confirmLabel: 'Restart', tone: 'info' },
    )
    if (confirmed) await window.omnitermAPI.plugin.restartApp()
  }, [activeSessionCount, showAlert, showConfirm])

  const toggle = useCallback(async (plugin: PluginDescriptor) => {
    if (plugin.permissions.includes('connections') && activeSessionCount > 0) {
      await showAlert('Close all active sessions before changing a connection-provider plugin.', {
        title: 'Plugin in use',
        tone: 'warning',
      })
      return
    }
    const enable = !plugin.enabled
    const confirmed = await showConfirm(
      `${enable ? 'Enable' : 'Disable'} “${plugin.name}”? Plugin-provided connections and features will update immediately.`,
      {
        title: `${enable ? 'Enable' : 'Disable'} plugin`,
        confirmLabel: enable ? 'Enable' : 'Disable',
        tone: enable ? 'info' : 'warning',
      },
    )
    if (!confirmed) return
    setBusyId(plugin.id)
    try {
      await window.omnitermAPI.plugin.setEnabled(plugin.id, enable)
      const ps = await window.omnitermAPI.plugin.list()
      setPlugins(ps)
      onProviderStatusChanged(ps.some(p => p.selectedConnectionProvider && p.enabled))
    } catch (error) {
      await showAlert(
        `Could not ${enable ? 'enable' : 'disable'} plugin: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    } finally {
      setBusyId(null)
    }
  }, [activeSessionCount, showAlert, showConfirm])

  const selectProvider = useCallback(async (plugin: PluginDescriptor) => {
    if (activeSessionCount > 0) {
      await showAlert('Close all active sessions before switching connection providers.', {
        title: 'Plugin in use',
        tone: 'warning',
      })
      return
    }
    const confirmed = await showConfirm(
      `Use “${plugin.name}” for workspace connections? Only metadata is copied between providers; passwords are always entered in the native client prompt.`,
      { title: 'Switch connection provider', confirmLabel: 'Use provider', tone: 'info' },
    )
    if (!confirmed) return
    setBusyId(plugin.id)
    try {
      const previous = plugins.find(candidate => candidate.selectedConnectionProvider)
      const previousTree = previous ? await window.omnitermAPI.connections.load() : null
      const ps = await window.omnitermAPI.plugin.selectConnectionProvider(plugin.id)
      setPlugins(ps)
      onProviderStatusChanged(true)
      setCapabilities(await window.omnitermAPI.plugin.connectionCapabilities())
      if (previous && previous.id !== plugin.id && previousTree?.connections?.length) {
        const migrate = await showConfirm(
          `Copy ${previousTree.connections.length} connection profile(s) to “${plugin.name}”? Only metadata is copied; no password data exists to migrate.`,
          {
            title: 'Migrate connection metadata',
            confirmLabel: 'Copy metadata',
            cancelLabel: 'Start empty',
            tone: 'info',
          },
        )
        if (migrate) await window.omnitermAPI.connections.save(previousTree)
      }
    } catch (error) {
      await showAlert(
        `Could not select the provider: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    } finally {
      setBusyId(null)
    }
  }, [activeSessionCount, onProviderStatusChanged, plugins, showAlert, showConfirm])

  const exportMetadata = useCallback(async () => {
    const selected = plugins.find(plugin => plugin.selectedConnectionProvider)
    if (!selected) return
    const tree = await window.omnitermAPI.connections.load()
    await window.omnitermAPI.files.exportJson({
      suggestedName: 'omniterm-connections.json',
      content: JSON.stringify({
        format: 'omniterm-connections',
        version: 1,
        provider: selected.id,
        connections: tree.connections ?? [],
        folders: tree.folders ?? [],
      }, null, 2),
    })
  }, [plugins])

  const importMetadata = useCallback(async () => {
    try {
      const imported = await window.omnitermAPI.files.importFile()
      if (!imported) return
      const tree = {
        connections: imported.connections ?? [],
        folders: imported.folders ?? [],
      }
      const confirmed = await showConfirm(
        `Import ${tree.connections.length} connection profile(s)? Passwords are never imported and must be entered again.`,
        { title: 'Import connection metadata', confirmLabel: 'Import', tone: 'info' },
      )
      if (!confirmed) return
      await window.omnitermAPI.connections.save(tree)
    } catch (error) {
      await showAlert(
        `Could not import metadata: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Import connections', tone: 'error' },
      )
    }
  }, [showAlert, showConfirm])

  const installedCount = plugins.filter(plugin => plugin.id !== 'omniterm.plugin-host').length
  const shown = onlyPluginId ? plugins.filter(plugin => plugin.id === onlyPluginId) : plugins
  return (
    <>
    <div className="px-4 py-3">
      {!onlyPluginId && <div className="mb-2 flex items-center gap-1">
        <div role="tablist" aria-label="Plugin sources" className="flex items-center gap-1">
          <button type="button" role="tab" aria-selected="true" className="h-[26px] rounded-md bg-[var(--bg-selected,var(--bg-hover))] px-2 text-[var(--fg-strong)]">
            Installed ({installedCount})
          </button>
          <Tooltip content="Not supported yet" placement="bottom">
            <button type="button" role="tab" aria-selected="false" aria-disabled="true" className="flex h-[26px] cursor-not-allowed items-center gap-1.5 px-2 text-[var(--fg-secondary)] opacity-55">
              Marketplace <span className="rounded-lg bg-[var(--bg-hover)] px-1.5 text-[10.5px]">soon</span>
            </button>
          </Tooltip>
        </div>
        <div className="flex-1" />
        <Tooltip content="Install a plugin package (.zip) built by the OmniTerm build wizard" placement="bottom">
          <Button disabled={busyId !== null} onClick={() => { void installPackage() }}>
            Install from disk…
          </Button>
        </Tooltip>
      </div>}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          No compatible plugins discovered.
        </p>
      ) : (
        <div>
          {shown.map(plugin => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              busy={busyId === plugin.id}
              anyBusy={busyId !== null}
              onConfigure={plugin.enabled ? configureAction?.(plugin.id) : undefined}
              onToggle={() => { void toggle(plugin) }}
              onSelectProvider={() => { void selectProvider(plugin) }}
              onRemove={() => { void removePlugin(plugin) }}
            />
          ))}
        </div>
      )}
      {restartRequired && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)] bg-[var(--bg-hover)] px-3 py-2">
          <span className="text-[11px] text-[var(--fg)]">Restart required to finish plugin changes.</span>
          <Tooltip content="Restart OmniTerm to apply plugin updates" placement="left">
            <Button variant="primary" size="small" onClick={() => { void restart() }}>
              Restart now
            </Button>
          </Tooltip>
        </div>
      )}
      {capabilities?.importExport && plugins.some(plugin => plugin.selectedConnectionProvider) && (
        <div className="mt-2 flex gap-2">
          <Tooltip content="Import connection metadata from file" placement="bottom">
            <Button onClick={() => { void importMetadata() }}>Import metadata</Button>
          </Tooltip>
          <Tooltip content="Export saved connection metadata to file" placement="bottom">
            <Button onClick={() => { void exportMetadata() }}>Export metadata</Button>
          </Tooltip>
        </div>
      )}
    </div>
    </>
  )
}
