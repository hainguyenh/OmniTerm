/**
 * Scaffold a new OmniTerm plugin.
 *
 *   node scripts/create-plugin.mjs <name> [target-dir]
 *   pnpm create:plugin my-plugin
 *
 * Produces a directory that the host will actually load: a manifest the sidecar's `describePlugin`
 * accepts, a `main` that matches where tsc emits, and a local copy of the contract types so the plugin
 * builds standalone (the same reason each plugins/*/src/types.ts exists — a plugin is a drop-in package, not a
 * workspace member).
 *
 * The template asks for NO permissions. Adding one is a deliberate act, and the host refuses any
 * capability the manifest did not declare — so a plugin that needs `connections` will fail loudly and
 * tell you which permission to add, which is a better default than handing out everything up front.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { API_VERSION, die, root } from './plugin-paths.mjs'

const [rawName, targetArg] = process.argv.slice(2)
if (!rawName) die('usage: node scripts/create-plugin.mjs <name> [target-dir]')

// Scoped names are fine ('@acme/thing'); the directory takes the last segment.
if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(rawName)) {
  die(`"${rawName}" is not a usable npm package name.`)
}
const dirName = rawName.split('/').pop()
const target = path.resolve(targetArg ?? process.cwd(), dirName)

if (existsSync(target)) die(`${target} already exists.`)

const displayName = dirName
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())

/** The host's version, so `hostVersion` starts as a range that actually matches this build. */
const hostVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const major = hostVersion.split('.')[0]

const pkg = {
  name: rawName,
  version: '0.1.0',
  private: true,
  description: `OmniTerm plugin: ${displayName}`,
  type: 'commonjs',
  main: 'dist/index.js',
  omnitermPlugin: {
    apiVersion: API_VERSION,
    hostVersion: `>=${hostVersion} <${Number(major) + 1}.0.0`,
    displayName,
    // Start with none. The host refuses any capability not declared here and names the one you need.
    permissions: [],
  },
  scripts: { build: 'tsc -p tsconfig.json' },
  devDependencies: { '@types/node': '^26.0.0', typescript: '^5.2.2' },
}

const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'CommonJS',
    moduleResolution: 'node',
    outDir: 'dist',
    rootDir: 'src',
    strict: true,
    declaration: true,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  include: ['src/**/*.ts'],
}

const indexTs = `/**
 * ${displayName} — an OmniTerm plugin.
 *
 * Runs in the plugin host sidecar (a Node process), NOT in the app's webview. \`activate\` is called once
 * at startup with the host API; register whatever this plugin provides and return.
 *
 * Every capability is gated on \`omnitermPlugin.permissions\` in package.json. The calls below are
 * commented out because the template declares none — uncomment a registration and add its permission
 * together, or the host will throw and tell you which one is missing.
 *
 * Credentials: OmniTerm stores no password and never will. \`host.services.credentials.isAvailable()\`
 * is false and \`set()\` rejects. Design around it (prompt per session, or point the user at a vault),
 * or supply your own storage — see docs/PLUGINS.md.
 */

import type { HostAPI, PluginModule } from './types'

export const name = '${rawName}'

export async function activate(host: HostAPI): Promise<void> {
  // Needs the "connections" permission:
  // host.registerConnectionProvider({
  //   load: () => ({ folders: [], connections: [] }),
  //   save: (tree) => { /* persist it */ },
  //   resolve: (id) => null,
  // })

  // Needs the "renderer" permission. Whatever this returns is handed to the app UI verbatim, so it
  // must never contain a secret.
  // host.registerInvokeHandler((method, ...args) => {
  //   throw new Error(\`${rawName}: unknown invoke method "\${method}"\`)
  // })

  // A private directory for this plugin's own files. Needs no permission.
  void host.services.storageDir
}

/** Called when the user disables the plugin. Release timers, watchers and handles here. */
export function deactivate(): void {}

const plugin: PluginModule = { name, activate, deactivate }
export default plugin
`

const readme = `# ${displayName}

An OmniTerm plugin.

    pnpm build:plugin ${path.relative(root, target) || '.'}
    pnpm install:plugin ${path.relative(root, target) || '.'}

Then restart OmniTerm and look under Plugins.

## Permissions

\`omnitermPlugin.permissions\` in \`package.json\` starts empty. The host refuses any capability the
manifest does not declare and names the missing permission in the error, so add them one at a time as
you need them.

## Credentials

OmniTerm holds no password, in any form. \`host.services.credentials.isAvailable()\` returns false and
\`set()\` rejects. If this plugin needs a secret, either prompt for it per session, point the user at
where it is kept, or supply your own \`CredentialStore\` — in which case protecting what you write is
this plugin's responsibility. See \`docs/PLUGINS.md\`.
`

mkdirSync(path.join(target, 'src'), { recursive: true })
writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')
writeFileSync(path.join(target, 'src', 'index.ts'), indexTs)
writeFileSync(path.join(target, 'README.md'), readme)

// The contract types, copied rather than imported: a plugin is a standalone drop-in package, so it must
// build without the workspace. Same reasoning as plugins/*/src/types.ts.
const contractTypes = path.join(root, 'plugins', 'full-connection-manager', 'src', 'types.ts')
if (!existsSync(contractTypes)) die(`Missing ${contractTypes} — cannot supply the plugin API types.`)
writeFileSync(path.join(target, 'src', 'types.ts'), readFileSync(contractTypes, 'utf8'))

const rel = path.relative(process.cwd(), target) || '.'
console.log(`✓ Created ${rel}

  Next:
    cd ${rel} && pnpm install
    pnpm build:plugin ${rel}
    pnpm install:plugin ${rel}

  Then restart OmniTerm. See docs/PLUGINS.md for the API and the credential policy.`)
