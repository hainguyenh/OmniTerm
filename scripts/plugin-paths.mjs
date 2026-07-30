/**
 * Shared plumbing for the plugin scaffolding scripts.
 *
 * The manifest rules here must agree with `describePlugin` in src-tauri/sidecar/manifest.cjs — that is
 * the code that actually decides whether a plugin loads. Duplicated rather than imported because these
 * scripts are ESM and the sidecar is CommonJS; `permissionsOf` and `API_VERSION` are the only two facts
 * that matter, and both fail loudly at load time if they drift.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Must track `PLUGIN_API_VERSION` in contract/index.ts. */
export const API_VERSION = 2

/** Must track `KNOWN_PERMISSIONS` in src-tauri/sidecar/host-api.cjs. */
export const KNOWN_PERMISSIONS = [
  'connections',
  'auth',
  'renderer',
  'credentials',
  'openExternal',
  'clipboard',
  'workspace',
]

/**
 * What each permission actually unlocks, for the warning `install-plugin` prints.
 *
 * A user approving an install deserves to know what they are approving in terms of consequences, not
 * capability names — so these describe the risk, not the API.
 */
export const PERMISSION_EFFECTS = {
  connections: 'Owns your saved connection list: can read, change and add connections.',
  auth: 'Can gate the whole app behind its own check — a broken one can lock you out.',
  renderer: 'Can be called from the app UI, and its return value is handed to the UI verbatim.',
  credentials: 'Asks for secret storage. OmniTerm provides none, so these calls will fail.',
  openExternal: 'Can open https URLs in your browser.',
  clipboard: 'Can write to your clipboard.',
  workspace: 'Can supply the workspace list and workspace-scoped connections.',
}

/** Where installed plugins live. Mirrors `pluginsDir` in src-tauri/sidecar/plugin-host.cjs. */
export function pluginsDir() {
  const appData =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(process.env.HOME ?? '', 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? '', '.config'))
  if (!appData) throw new Error('Could not determine your application data directory.')
  return path.join(appData, 'com.omniterm.app', 'plugins')
}

/** Read and structurally validate a plugin's package.json, or throw with the reason it would not load. */
export function readManifest(dir) {
  const pkgPath = path.join(dir, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${dir}`)

  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (err) {
    throw new Error(`${pkgPath} is not valid JSON: ${err.message}`)
  }

  const manifest = pkg.omnitermPlugin
  if (!manifest) throw new Error(`${pkgPath} has no "omnitermPlugin" key — the host would not see it.`)
  if (!pkg.name || typeof pkg.name !== 'string') throw new Error(`${pkgPath} has no "name".`)

  const apiVersion = manifest.apiVersion ?? 1
  if (apiVersion !== API_VERSION) {
    throw new Error(
      `Plugin targets API version ${apiVersion}; this host implements ${API_VERSION}. It would load as "incompatible".`,
    )
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const unknown = permissions.filter((p) => !KNOWN_PERMISSIONS.includes(p))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown permission(s): ${unknown.join(', ')}. Allowed: ${KNOWN_PERMISSIONS.join(', ')}.`,
    )
  }

  return { pkg, manifest, permissions, main: pkg.main ?? 'dist/index.js' }
}

/** A plugin directory name safe to use on disk. Mirrors the sanitizing the sidecar used to do. */
export function safeDirName(id) {
  return id.replace(/[/\\?%*:|"<>]/g, '_')
}

export function die(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}
