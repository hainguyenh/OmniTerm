/**
 * Build a plugin and verify the result is something the host can load.
 *
 *   node scripts/build-plugin.mjs [dir]
 *   pnpm build:plugin ./my-plugin
 *
 * Defaults to the Full Remote Suite. The check after tsc is the point: the
 * sidecar's only failure mode for a plugin that compiled but emitted somewhere else is
 * `Main file not found`, discovered at app startup rather than here.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { die, readManifest, root } from './plugin-paths.mjs'

const dir = path.resolve(process.argv[2] ?? path.join(root, 'plugins', 'full-connection-manager'))
if (!existsSync(dir)) die(`${dir} does not exist.`)

let manifest
try {
  manifest = readManifest(dir)
} catch (err) {
  die(err.message)
}

if (!existsSync(path.join(dir, 'tsconfig.json'))) {
  die(`No tsconfig.json in ${dir}. If this plugin needs no build step, skip this script.`)
}

console.log(`Building ${manifest.pkg.name} in ${path.relative(process.cwd(), dir) || '.'} …`)

/**
 * Locate a real `tsc`.
 *
 * Not `npx tsc`: when TypeScript is not installed locally, npx resolves the `tsc` package on the
 * registry, which is a decoy that prints "This is not the tsc command you are looking for" and exits
 * non-zero. Prefer the plugin's own install, then the host repo's — a plugin scaffolded here can be
 * built before `pnpm install` has ever run inside it.
 */
function findTsc() {
  for (const base of [dir, root]) {
    // The compiler's own entry script, not the `.bin` shim: running it with `process.execPath` needs no
    // shell, which keeps the plugin directory's path out of a command line.
    const candidate = path.join(base, 'node_modules', 'typescript', 'bin', 'tsc')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const tscBin = findTsc()
if (!tscBin) {
  die(
    'Could not find the TypeScript compiler.\n' +
      `  Run \`pnpm install\` in ${path.relative(process.cwd(), dir) || '.'} (or in the OmniTerm repo).`,
  )
}

const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
  cwd: dir,
  stdio: 'inherit',
})
if (tsc.status !== 0) die('TypeScript build failed.')

const mainFile = path.resolve(dir, manifest.main)
if (!existsSync(mainFile)) {
  die(
    `Build succeeded but "main" (${manifest.main}) does not exist.\n` +
      `  The host requires it and would report "Main file not found" at startup.\n` +
      `  Check "outDir" in tsconfig.json against "main" in package.json.`,
  )
}

console.log(`✓ Built ${manifest.pkg.name} → ${path.relative(dir, mainFile)}`)
if (manifest.permissions.length === 0) {
  console.log('  Declares no permissions. Any host capability it calls will be refused.')
}
