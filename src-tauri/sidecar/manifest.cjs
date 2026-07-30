/**
 * manifest.cjs — validate a plugin's `package.json` into a PluginDescriptor.
 *
 * Split out of plugin-host.cjs so the compatibility rules are testable without requiring that module,
 * which reads argv, creates directories, and attaches to stdio at import time.
 *
 * Every check here runs BEFORE `require` of the plugin's main file. That ordering is the point: loading
 * a module executes its top level, so a plugin found incompatible after the load has already run.
 */

const { KNOWN_PERMISSIONS } = require('./host-api.cjs')

/** Must track `PLUGIN_API_VERSION` in contract/index.ts. */
const PLUGIN_API_VERSION = 2

/**
 * Build a descriptor for `pkg`, or return null if this is not a plugin at all.
 *
 * A returned descriptor with `status: 'incompatible'` should be registered (so the user can see why it
 * did not load) but never loaded.
 */
function describePlugin(pkg, source) {
  const manifest = pkg && pkg.omnitermPlugin
  if (!manifest) return null

  const descriptor = {
    id: pkg.name,
    name: manifest.displayName || pkg.name,
    description: pkg.description || '',
    version: pkg.version || '0.0.0',
    apiVersion: manifest.apiVersion || 1,
    hostVersion: manifest.hostVersion || '>=1.0.0',
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    source,
    enabled: true,
    status: 'loaded',
    activeConnectionProvider: false,
    selectedConnectionProvider: false,
    activeAuthProvider: false,
    activeInvokeHandler: false,
  }

  if (!descriptor.id || typeof descriptor.id !== 'string') {
    return { ...descriptor, id: descriptor.id || '<unnamed>', status: 'incompatible', error: 'package.json has no "name".' }
  }

  if (descriptor.apiVersion !== PLUGIN_API_VERSION) {
    return {
      ...descriptor,
      status: 'incompatible',
      error: `Plugin targets API version ${descriptor.apiVersion}; this host implements ${PLUGIN_API_VERSION}.`,
    }
  }

  // A permission the host cannot enforce is worse than a missing one: the manifest reads as though
  // something were being checked. Refuse rather than silently ignore it.
  const unknown = descriptor.permissions.filter((p) => !KNOWN_PERMISSIONS.includes(p))
  if (unknown.length > 0) {
    return { ...descriptor, status: 'incompatible', error: `Unknown permission(s): ${unknown.join(', ')}` }
  }

  return descriptor
}

module.exports = { describePlugin, PLUGIN_API_VERSION }
