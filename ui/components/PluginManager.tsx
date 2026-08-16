import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseDialogReturn } from '../hooks/useDialog'
import { Tooltip } from './Tooltip'

interface PluginManagerProps {
  activeSessionCount: number
  onProviderStatusChanged(hasConnectionProvider: boolean): void
  showAlert: UseDialogReturn['showAlert']
  showConfirm: UseDialogReturn['showConfirm']
}

function pluginFeatureSummary(plugin: PluginDescriptor): string[] {
  if (plugin.id === '@omniterm/full-connection-manager') {
    return ['Integrated SSH', 'Native RDP', 'Workspace connections', 'Passwords never stored']
  }
  if (plugin.id === '@omniterm/native-batch-connections') {
    return ['Windows OpenSSH', 'Native mstsc', 'BAT launchers', 'Passwords never stored']
  }
  return plugin.permissions.map(permission => permission.replace(/([A-Z])/g, ' $1').trim())
}

export default function PluginManager({
  activeSessionCount,
  onProviderStatusChanged,
  showAlert,
  showConfirm,
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

  return (
    <>
    <div className="px-4 py-3 border-t border-[var(--theme-border)]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase font-bold tracking-widest text-[var(--theme-dim)]">Plugins</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--theme-dim)]">
            {plugins.filter(plugin => plugin.id !== 'omniterm.plugin-host').length} installed
          </span>
          <Tooltip content="Install plugin package from .zip archive" placement="bottom">
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => { void installPackage() }}
              className="rounded-md border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-fg)] hover:border-[var(--theme-accent)] disabled:opacity-50"
            >
              Install ZIP
            </button>
          </Tooltip>
        </div>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-[var(--theme-dim)]">
        Install a plugin ZIP created by the OmniTerm build wizard. The native installer validates the
        package and shows its permissions before copying it.
      </p>
      {plugins.length === 0 ? (
        <p className="text-[11px] text-[var(--theme-dim)] rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-2">
          No compatible plugins discovered.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {plugins.map(plugin => (
            <div key={plugin.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card-bg)] px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-[var(--theme-fg)]">{plugin.name}</span>
                    <span className="text-[9px] text-[var(--theme-dim)]">v{plugin.version}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--theme-dim)]">
                    <span>{plugin.source}</span>
                    <span>•</span>
                    <span className={plugin.status === 'error' ? 'text-theme-error' : plugin.status === 'loaded' ? 'text-theme-success' : ''}>
                      {plugin.status}
                    </span>
                    {plugin.activeConnectionProvider && <span>• connection provider</span>}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={plugin.enabled}
                  aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                  disabled={busyId === plugin.id || plugin.status === 'incompatible'}
                  onClick={() => { void toggle(plugin) }}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${plugin.enabled ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border)]'}`}
                >
                  {/* Anchored with `left`, not `translate-x`. An absolute box with no horizontal anchor
                      keeps its static position, and a <button> centers its content — so the knob
                      started mid-pill and the translate pushed it past the right edge when on. */}
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${plugin.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
              {plugin.error && <p className="mt-1.5 text-[10px] leading-relaxed text-theme-error">{plugin.error}</p>}
              {plugin.description && (
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--theme-fg)]">{plugin.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {pluginFeatureSummary(plugin).map(feature => (
                  <span key={feature}
                    className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-0.5 text-[9px] text-[var(--theme-dim)]">
                    {feature}
                  </span>
                ))}
              </div>
              {plugin.permissions.length > 0 && (
                <p className="mt-1.5 truncate text-[9px] text-[var(--theme-dim)]" title={plugin.permissions.join(', ')}>
                  Permissions: {plugin.permissions.join(', ')}
                </p>
              )}
              {plugin.activeConnectionProvider && plugin.enabled && plugin.status === 'loaded' && (
                <Tooltip
                  content={plugin.selectedConnectionProvider ? 'Currently active connection provider' : 'Select this plugin as the active connection provider'}
                  placement="bottom"
                >
                  <button type="button"
                    disabled={busyId === plugin.id || plugin.selectedConnectionProvider}
                    onClick={() => { void selectProvider(plugin) }}
                    className={`mt-2 w-full rounded-md border px-2 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-default ${
                      plugin.selectedConnectionProvider
                        ? 'border-[var(--theme-accent)] bg-[var(--theme-hover-bg)] text-[var(--theme-accent)]'
                        : 'border-[var(--theme-border)] text-[var(--theme-fg)] hover:border-[var(--theme-accent)]'
                    }`}>
                    {plugin.selectedConnectionProvider ? 'Active connection provider' : 'Use for connections'}
                  </button>
                </Tooltip>
              )}
              {plugin.source === 'user' && (
                <Tooltip content={`Remove “${plugin.name}” from computer`} placement="bottom">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => { void removePlugin(plugin) }}
                    className="mt-2 w-full rounded-md border border-theme-error/60 px-2 py-1.5 text-[10px] font-semibold text-theme-error hover:bg-theme-error/10 disabled:opacity-50"
                  >
                    Remove plugin
                  </button>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}
      {restartRequired && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-hover-bg)] px-3 py-2">
          <span className="text-[10px] text-[var(--theme-fg)]">Restart required to finish plugin changes.</span>
          <Tooltip content="Restart OmniTerm to apply plugin updates" placement="left">
            <button type="button" onClick={() => { void restart() }}
              className="shrink-0 rounded-md bg-[var(--theme-accent)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-accent-fg)]">
              Restart now
            </button>
          </Tooltip>
        </div>
      )}
      {capabilities?.importExport && plugins.some(plugin => plugin.selectedConnectionProvider) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Tooltip content="Import connection metadata from file" placement="bottom">
            <button type="button" onClick={() => { void importMetadata() }}
              className="rounded-md border border-[var(--theme-border)] px-2 py-1.5 text-[10px] text-[var(--theme-fg)] hover:border-[var(--theme-accent)]">
              Import metadata
            </button>
          </Tooltip>
          <Tooltip content="Export saved connection metadata to file" placement="bottom">
            <button type="button" onClick={() => { void exportMetadata() }}
              className="rounded-md border border-[var(--theme-border)] px-2 py-1.5 text-[10px] text-[var(--theme-fg)] hover:border-[var(--theme-accent)]">
              Export metadata
            </button>
          </Tooltip>
        </div>
      )}
    </div>
    </>
  )
}
