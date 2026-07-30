/**
 * host-api.cjs — HostAPI & HostServices implementation for OmniTerm sidecar plugins
 */
const path = require('path')
const fs = require('fs')

/**
 * Permissions the host recognises and enforces; mirrors `PluginPermission` in contract/index.ts.
 *
 * Lives next to the enforcement rather than next to the discovery code: a permission that appears in
 * this list but is not gated below would read to a plugin author as a check that does not exist.
 */
const KNOWN_PERMISSIONS = Object.freeze([
  'connections',
  'auth',
  'renderer',
  'openExternal',
  'clipboard',
  'workspace',
])

/**
 * Throw unless the plugin declared `permission` in its manifest.
 *
 * The manifest's `permissions` array was parsed into the descriptor and then never read, so every
 * plugin held every capability and the field was decoration. Enforced here, at the single boundary
 * where a plugin touches the host, so a plugin gets exactly what it asked the user to approve.
 */
function requirePermission(pluginId, permissions, permission, what) {
  if (!permissions.includes(permission)) {
    throw new Error(
      `Plugin "${pluginId}" called ${what} without declaring the "${permission}" permission. ` +
        `Add it to omnitermPlugin.permissions in package.json.`,
    )
  }
}

/** A single path segment safe to use as a directory name. Mirrors scripts/install-plugin.mjs. */
function safeDirName(id) {
  return id.replace(/[/\\?%*:|"<>]/g, '_')
}

/**
 * A plugin's private directory, kept out of the plugins tree.
 *
 * It used to be `plugins/<id>/storage` — *inside the plugin's own install directory*. Two things went
 * wrong there. Installing replaces a plugin by deleting the target directory first, so every upgrade
 * silently destroyed the plugin's data (for the reference plugin, the user's whole connection tree). And
 * a plugin's storage directory sat in the same listing discovery walks, so plugin data and plugin code
 * shared a namespace. Storage belongs beside the plugins directory, not in it.
 *
 * The id is sanitized to a single path segment: unsanitized, a scoped id ('@acme/thing') created a bare
 * namespace directory, and an id containing `..` would have escaped the directory entirely.
 */
function storageDirFor(appDataDir, pluginId) {
  const dir = path.join(appDataDir, 'plugin-storage', safeDirName(pluginId))
  const legacy = path.join(appDataDir, 'plugins', safeDirName(pluginId), 'storage')

  // Carry data over from the old location once. Best-effort: failing to migrate must not stop the
  // plugin from loading, and the legacy path is left alone if anything goes wrong.
  if (!fs.existsSync(dir) && fs.existsSync(legacy)) {
    try {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      fs.renameSync(legacy, dir)
      // The move can leave an empty `plugins/<id>/` behind. Remove it only if it is empty, so a plugin
      // that is genuinely installed there keeps its code: `rmdir` fails on a non-empty directory, which
      // is exactly the check wanted.
      try { fs.rmdirSync(path.dirname(legacy)) } catch { /* still holds the plugin */ }
    } catch { /* fall through to a fresh directory */ }
  }
  return dir
}

class HostServicesImpl {
  constructor(pluginId, appDataDir, protocol, permissions) {
    this.pluginId = pluginId
    this.storageDir = storageDirFor(appDataDir, pluginId)
    this.protocol = protocol
    this.permissions = permissions

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }

  }

  log(message) {
    this.protocol.sendNotification('host.log', { pluginId: this.pluginId, message })
  }

  async openExternal(url) {
    requirePermission(this.pluginId, this.permissions, 'openExternal', 'services.openExternal()')
    await this.protocol.callRemote('host.openExternal', { url })
  }

  async writeClipboard(text) {
    requirePermission(this.pluginId, this.permissions, 'clipboard', 'services.writeClipboard()')
    await this.protocol.callRemote('host.writeClipboard', { text })
  }
}

class HostAPIImpl {
  constructor(descriptor, appDataDir, protocol, registry) {
    const permissions = Object.freeze([...(descriptor.permissions || [])])
    this.plugin = Object.freeze({
      id: descriptor.id,
      version: descriptor.version,
      permissions,
    })
    this.services = new HostServicesImpl(descriptor.id, appDataDir, protocol, permissions)
    this.registry = registry
  }

  /** @throws if the plugin did not declare `permission`. */
  #gate(permission, what) {
    requirePermission(this.plugin.id, this.plugin.permissions, permission, what)
  }

  registerConnectionProvider(provider) {
    this.#gate('connections', 'registerConnectionProvider()')
    this.registry.connectionProviders.set(this.plugin.id, provider)
    this.registry.updateStatus(this.plugin.id, { activeConnectionProvider: true })
  }

  registerAuthProvider(provider) {
    // The gate that decides whether the app opens at all. A plugin must say so in its manifest.
    this.#gate('auth', 'registerAuthProvider()')
    this.registry.authProviders.set(this.plugin.id, provider)
    this.registry.updateStatus(this.plugin.id, { activeAuthProvider: true })
  }

  registerWorkspaceProvider(provider) {
    this.#gate('workspace', 'registerWorkspaceProvider()')
    this.registry.workspaceProviders.set(this.plugin.id, provider)
  }

  registerInvokeHandler(handler) {
    // 'renderer': whatever this handler returns is passed to the webview verbatim by the host.
    this.#gate('renderer', 'registerInvokeHandler()')
    this.registry.invokeHandlers.set(this.plugin.id, handler)
    this.registry.updateStatus(this.plugin.id, { activeInvokeHandler: true })
  }
}

module.exports = { HostAPIImpl, requirePermission, KNOWN_PERMISSIONS }
