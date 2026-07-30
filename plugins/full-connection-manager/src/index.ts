/**
 * @omniterm/full-connection-manager — full remote connection provider.
 *
 * Activated by the host's main-process plugin loader. Registers:
 *   • a ConnectionProvider backed by the encrypted ConnectionStore (saved tree + credential
 *     resolution, including the 'none' / 'url' conveniences);
 *   • an invoke handler exposing plugin-specific RPC (`setCredential`, `pendingMigrations`) reachable
 *     from the renderer via `window.omnitermAPI.plugin.invoke(...)`. Everything reachable there must
 *     be renderer-safe by construction: the host returns an invoke result to the webview verbatim, so
 *     a method that returns a secret leaks it. `exportAll` did exactly that and is gone;
 *   • no AuthProvider by default (the host stays login-free); a deployment can opt into one.
 */

import { ConnectionStore, stripMetaKeepingSecret } from './store'
import path from 'node:path'
import type { ConnectionProvider, ConnectionScope, HostAPI, PluginModule, ResolvedConnection } from './types'

export const name = '@omniterm/full-connection-manager'

export async function activate(host: HostAPI): Promise<void> {
  const store = new ConnectionStore(host.services.storageDir, host.services.credentials)
  await store.initialize()
  const scopedStores = new Map<string, ConnectionStore>()
  const storeFor = (scope: ConnectionScope) => {
    if (scope.kind === 'personal') return store
    const key = path.resolve(scope.workspacePath)
    let scoped = scopedStores.get(key)
    if (!scoped) {
      scoped = new ConnectionStore(
        path.join(key, '.omniterm', 'full-connection-manager'),
        host.services.credentials,
      )
      scopedStores.set(key, scoped)
    }
    return scoped
  }
  const resolveFrom = async (target: ConnectionStore, id: string): Promise<ResolvedConnection | null> => {
    const c = await target.resolveRaw(id)
    if (!c) return null
    const plain = stripMetaKeepingSecret(c)
    if (c.credentialMode === 'url' && c.passwordUrl) {
      try { await host.services.openExternal(c.passwordUrl) } catch { /* non-fatal */ }
      return { ...plain, password: undefined }
    }
    if (c.credentialMode === 'none') return { ...plain, password: undefined }
    return plain
  }

  const provider: ConnectionProvider = {
    capabilities: () => ({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'os-vault',
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

  // Reachable from the renderer, so every branch must return something that carries no secret.
  host.registerInvokeHandler((method, ...args) => {
    switch (method) {
      case 'setCredential': {
        const [id, cfg] = args as [string, { mode?: 'store' | 'none' | 'url'; password?: string; passwordUrl?: string }]
        return store.setCredential(id, cfg ?? {})
      }
      // Ids and names of connections whose legacy password could not be migrated — no secret.
      case 'pendingMigrations':
        return store.pendingMigrations()
      case 'confirmStoredCredential': {
        const [id] = args as [string]
        return (async () => {
          for (const candidate of [store, ...scopedStores.values()]) {
            const result = await candidate.confirmStoredCredential(id)
            if (result.ok || !result.error?.startsWith('Unknown connection')) return result
          }
          return { ok: false, error: `Unknown connection "${id}".` }
        })()
      }
      default:
        throw new Error(`full-connection-manager: unknown invoke method "${method}"`)
    }
  })

  host.services.log('full-connection-manager activated')
}

/** The reference plugin owns no background handles; retained as an explicit lifecycle example. */
export function deactivate(): void {
  // No background handles in the reference plugin.
}

const plugin: PluginModule = { name, activate, deactivate }
export default plugin
