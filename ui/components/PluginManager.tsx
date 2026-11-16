import { useCallback, useEffect, useState } from 'react'

import type { UseDialogReturn } from '../hooks/useDialog'

import { PluginCard } from './PluginCard'

interface PluginManagerProps {
  showAlert: UseDialogReturn['showAlert']
  showConfirm: UseDialogReturn['showConfirm']
  /** The action that opens a plugin's settings page, when it has one. */
  configureAction?: (pluginId: string) => (() => void) | undefined
  /** Show only this plugin (the Plugins dialog's details pane). */
  onlyPluginId?: string
}

/** OmniTerm's built-in features (Agent Quota, Always Awake) with their on/off switches. */
export default function PluginManager({
  showAlert,
  showConfirm,
  configureAction,
  onlyPluginId,
}: PluginManagerProps) {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setPlugins(await window.omnitermAPI.plugin.list())
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

  const toggle = useCallback(async (plugin: PluginDescriptor) => {
    const enable = !plugin.enabled
    const confirmed = await showConfirm(
      `${enable ? 'Enable' : 'Disable'} “${plugin.name}”? Its features will update immediately.`,
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
      setPlugins(await window.omnitermAPI.plugin.list())
    } catch (error) {
      await showAlert(
        `Could not ${enable ? 'enable' : 'disable'} plugin: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Plugin Manager', tone: 'error' },
      )
    } finally {
      setBusyId(null)
    }
  }, [showAlert, showConfirm])

  const shown = onlyPluginId ? plugins.filter(plugin => plugin.id === onlyPluginId) : plugins
  return (
    <div className="px-4 py-3">
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
              onConfigure={plugin.enabled ? configureAction?.(plugin.id) : undefined}
              onToggle={() => { void toggle(plugin) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
