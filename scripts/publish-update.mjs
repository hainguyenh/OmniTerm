/**
 * Generate and print the `latest.json` manifest the native updater fetches from GitHub Releases.
 *
 * Run AFTER `tauri build` has produced signed artifacts (`createUpdaterArtifacts: true` emits
 * `*.sig` sidecars). Publish flow, end to end:
 *
 *   1. One-time per machine: `pnpm tauri signer generate -w ~/.tauri/omniterm.key`
 *      — keep the PRIVATE key local; export TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) for packaging.
 *   2. `node scripts/configure-tauri-updater.mjs` (env pubkey + endpoint) before `tauri build`.
 *   3. `tauri build` → bundles + `.sig` files land in target/release/bundle.
 *   4. This script: `node scripts/publish-update.mjs <version> <bundle-dir> <download-base-url>`
 *      prints latest.json; attach it plus every bundle/sig pair to the GitHub release tagged v<version>.
 *
 * The updater then resolves https://...releases/latest/download/latest.json automatically.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [version, bundleDir, baseUrl] = process.argv.slice(2)
if (!version || !bundleDir || !baseUrl) {
  console.error('usage: node scripts/publish-update.mjs <version> <bundle-dir> <download-base-url>')
  process.exit(1)
}

const dir = resolve(bundleDir)
const PLATFORM_PATTERNS = [
  ['windows-x86_64', /\.msi\.zip$/],
  ['windows-x86_64-nsis', /\.exe\.zip$/],
  ['darwin-aarch64', /\.app\.tar\.gz$/],
  ['linux-x86_64', /\.AppImage\.tar\.gz$/],
]

const platforms = {}
for (const name of readdirSync(dir)) {
  for (const [platform, pattern] of PLATFORM_PATTERNS) {
    if (!pattern.test(name)) continue
    const signature = readdirSync(dir).find((f) => f === `${name}.sig`)
    if (!signature) {
      console.error(`missing signature sidecar for ${name} — was createUpdaterArtifacts enabled?`)
      process.exit(1)
    }
    platforms[platform] = {
      signature: readFileSync(join(dir, `${name}.sig`), 'utf8').trim(),
      url: `${baseUrl.replace(/\/$/, '')}/${name}`,
    }
  }
}

if (Object.keys(platforms).length === 0) {
  console.error('no updater artifacts found in', dir)
  process.exit(1)
}

console.log(JSON.stringify({ version, notes: `Release ${version}`, pub_date: new Date().toISOString(), platforms }, null, 2))
