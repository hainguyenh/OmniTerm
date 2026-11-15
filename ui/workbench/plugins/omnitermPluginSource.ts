import type { ComponentType } from 'react'

import { registerHostPluginSource } from '../../ide/features/plugins/pluginsDialogStore'
import type { HostPlugin, HostPluginSource } from '../../ide/features/plugins/pluginsDialogStore'

/** The sidecar that runs the Node plugins; it is not a plugin the user manages. */
const PLUGIN_HOST_ID = 'omniterm.plugin-host'

export interface NodePluginAPI {
  list(): Promise<PluginDescriptor[]>
  setEnabled(id: string, enabled: boolean): Promise<unknown>
  builtinIds(): Promise<string[]>
  onChanged(callback: () => void): () => void
  installPackage(): Promise<null | { name: string; restartRequired: boolean }>
  restartApp(): Promise<void>
}

/** A Node plugin as a row of the Plugins dialog. */
export function toHostPlugin(plugin: PluginDescriptor): HostPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description ?? '',
    version: plugin.version,
    enabled: plugin.enabled,
    builtin: plugin.source === 'bundled',
    error: plugin.status === 'error' || plugin.status === 'incompatible' ? (plugin.error ?? plugin.status) : undefined,
  }
}

/**
 * Lists OmniTerm's Node plugins in the Plugins dialog, next to the IDE plugins, and names the IDE
 * plugins the app ships so both read as one Built-in group. The list follows the backend's
 * plugins-changed event, so a change made anywhere shows without polling.
 */
export function registerOmniTermPluginSource(api: NodePluginAPI, Details: ComponentType<{ id: string }>): () => void {
  let plugins: readonly HostPlugin[] = []
  const listeners = new Set<() => void>()
  let disposed = false
  const reload = () => {
    void api.list().then((list) => {
      if (disposed) return
      plugins = list.filter((plugin) => plugin.id !== PLUGIN_HOST_ID).map(toHostPlugin)
      listeners.forEach((listener) => listener())
    })
  }
  const source = (builtinPluginIds: readonly string[]): HostPluginSource => ({
    plugins: () => plugins,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setEnabled: async (id, enabled) => {
      await api.setEnabled(id, enabled)
      reload()
    },
    Details,
    builtinPluginIds,
    installPackage: {
      label: 'Install OmniTerm Plugin from Package…',
      run: async () => {
        const installed = await api.installPackage()
        reload()
        return installed
      },
      restart: () => void api.restartApp(),
    },
  })
  let unregister = registerHostPluginSource(source([]))
  void api.builtinIds().then((ids) => {
    if (disposed) return
    unregister()
    unregister = registerHostPluginSource(source(ids))
  })
  const stopListening = api.onChanged(reload)
  reload()
  return () => {
    disposed = true
    stopListening()
    unregister()
  }
}
