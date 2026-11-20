import type { ComponentType } from 'react'

import { registerHostPluginSource } from '../../ide/features/plugins/pluginsDialogStore'
import type { HostPlugin, HostPluginSource } from '../../ide/features/plugins/pluginsDialogStore'

export interface BuiltinFeatureAPI {
  list(): Promise<PluginDescriptor[]>
  setEnabled(id: string, enabled: boolean): Promise<unknown>
  builtinIds(): Promise<string[]>
  onChanged(callback: () => void): () => void
}

/** A built-in feature as a row of the Plugins dialog. */
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
 * Lists OmniTerm's built-in features in the Plugins dialog, next to the IDE plugins, and names the IDE
 * plugins the app ships so both read as one Built-in group. The list follows the backend's
 * plugins-changed event, so a change made anywhere shows without polling.
 */
export function registerOmniTermPluginSource(api: BuiltinFeatureAPI, Details: ComponentType<{ id: string }>): () => void {
  let plugins: readonly HostPlugin[] = []
  const listeners = new Set<() => void>()
  let disposed = false
  const reload = () => {
    void api.list().then((list) => {
      if (disposed) return
      plugins = list.map(toHostPlugin)
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
