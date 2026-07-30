/**
 * Install a built plugin so OmniTerm discovers it on next launch.
 *
 *   node scripts/install-plugin.mjs <dir> [--force]
 *   pnpm install:plugin ./my-plugin
 *
 * This replaces a `plugin_install` Tauri command that copied a caller-supplied path into the plugins
 * directory and immediately `require`d it. Every Tauri command is callable from webview JS, so that was
 * arbitrary local code execution reachable from a page. Installing a plugin runs its code as you, with
 * your files and your network — it is not a thing the app should be able to decide to do.
 *
 * This remains the developer-oriented directory installer. The app's nontechnical ZIP flow is
 * separate: Rust owns the native picker, validates the archive, and displays a native permission
 * confirmation, so webview JavaScript still cannot nominate an arbitrary local path.
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import { PERMISSION_EFFECTS, die, pluginsDir, readManifest, safeDirName } from './plugin-paths.mjs'

const args = process.argv.slice(2)
const force = args.includes('--force')
const source = args.find((a) => !a.startsWith('--'))

if (!source) die('usage: node scripts/install-plugin.mjs <dir> [--force]')

const sourceDir = path.resolve(source)
if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  die(`${sourceDir} is not a directory.`)
}

let manifest
try {
  manifest = readManifest(sourceDir)
} catch (err) {
  die(err.message)
}

// Refuse an unbuilt plugin here rather than letting it install and fail at app startup.
const mainFile = path.resolve(sourceDir, manifest.main)
if (!existsSync(mainFile)) {
  die(`"main" (${manifest.main}) does not exist. Run: pnpm build:plugin ${source}`)
}

const targetDir = path.join(pluginsDir(), safeDirName(manifest.pkg.name))

// Installing a plugin from the place it is already installed would delete the source: the replace below
// removes the target first, and here they are the same directory.
if (path.resolve(targetDir) === sourceDir) {
  die(`${sourceDir} is already the install location — nothing to do.`)
}

const replacing = existsSync(targetDir)

console.log(`
  Plugin:  ${manifest.pkg.name} ${manifest.pkg.version}${manifest.manifest.displayName ? ` (${manifest.manifest.displayName})` : ''}
  From:    ${sourceDir}
  Install: ${targetDir}${replacing ? '  [replacing an existing install]' : ''}
`)

if (manifest.permissions.length === 0) {
  console.log('  Permissions: none declared.\n')
} else {
  console.log('  Permissions it is asking for:')
  for (const p of manifest.permissions) {
    console.log(`    • ${p} — ${PERMISSION_EFFECTS[p] ?? 'unknown capability'}`)
  }
  console.log('')
}

console.log(`  A plugin runs as you, with full access to your files and network.
  Only install one you trust.
`)

if (!force) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('  Install it? [y/N] ')).trim().toLowerCase()
  rl.close()
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Cancelled. Nothing was copied.')
    process.exit(1)
  }
}

// Replace rather than merge: a stale file left from a previous version is still `require`-able.
if (replacing) rmSync(targetDir, { recursive: true, force: true })
mkdirSync(path.dirname(targetDir), { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true })

console.log(`
✓ Installed ${manifest.pkg.name}

  Restart OmniTerm, then check Plugins in the sidebar.
  To remove it: delete ${targetDir}`)
