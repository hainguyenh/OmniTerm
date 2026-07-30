/**
 * @omniterm/full-connection-manager — workspace-aware SSH/RDP connection provider.
 *
 * Connection profiles contain metadata only. Authentication always happens inside the native SSH or
 * RDP client prompt; this plugin has no credential service, password field, or renderer invoke handler.
 */

import { ConnectionStore } from './store'
import path from 'node:path'
import type { Connection, ConnectionProvider, ConnectionScope, HostAPI, PluginModule } from './types'

export const name = '@omniterm/full-connection-manager'

export async function activate(host: HostAPI): Promise<void> {
  const store = new ConnectionStore(host.services.storageDir)
  const scopedStores = new Map<string, ConnectionStore>()
  const storeFor = (scope: ConnectionScope) => {
    if (scope.kind === 'personal') return store
    const key = path.resolve(scope.workspacePath)
    let scoped = scopedStores.get(key)
    if (!scoped) {
      scoped = new ConnectionStore(path.join(key, '.omniterm', 'full-connection-manager'))
      scopedStores.set(key, scoped)
    }
    return scoped
  }
  const resolveFrom = async (target: ConnectionStore, id: string): Promise<Connection | null> => {
    const connection = target.resolveRaw(id)
    if (!connection) return null
    if (connection.passwordHelpUrl) {
      try { await host.services.openExternal(connection.passwordHelpUrl) } catch { /* non-fatal */ }
    }
    return connection
  }

  const provider: ConnectionProvider = {
    capabilities: () => ({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'prompt-every-time',
      scopes: ['personal', 'workspace'],
      sftp: false,
      importExport: true,
    }),
    load: () => store.loadTree(),
    save: (tree) => store.saveTree(tree),
    resolve: (id) => resolveFrom(store, id),
    loadScoped: (scope) => storeFor(scope).loadTree(),
    saveScoped: (scope, tree) => storeFor(scope).saveTree(tree),
    resolveScoped: (scope, id) => resolveFrom(storeFor(scope), id),
  }

  host.registerConnectionProvider(provider)
  host.services.log('full-connection-manager activated')
}

export function deactivate(): void {}

const plugin: PluginModule = { name, activate, deactivate }
export default plugin
