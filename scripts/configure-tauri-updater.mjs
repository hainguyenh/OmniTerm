/**
 * Inject native-updater config into src-tauri/tauri.conf.json at build time.
 *
 * The updater only exists in signed release builds: this script runs BEFORE `tauri build` and
 * writes `plugins.updater` (endpoints + the minisign PUBLIC key) plus
 * `bundle.createUpdaterArtifacts`, both sourced from the environment. Nothing is written when the
 * env vars are absent, so everyday dev builds keep an unconfigured updater and every command in
 * update_manager.rs degrades to a typed "unavailable" result.
 *
 * Required for release builds:
 *   OMNITERM_UPDATER_PUBKEY   minisign public key (`pnpm tauri signer generate` output)
 *   OMNITERM_UPDATER_ENDPOINT latest.json URL, e.g.
 *                             https://github.com/<owner>/<repo>/releases/latest/download/latest.json
 *
 * The PRIVATE key must never be set here or committed; it signs artifacts during packaging via
 * TAURI_SIGNING_PRIVATE_KEY (see scripts/publish-update.mjs for the full flow).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const confPath = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
const pubkey = process.env.OMNITERM_UPDATER_PUBKEY
const endpoint = process.env.OMNITERM_UPDATER_ENDPOINT

if (!pubkey || !endpoint) {
  console.log('[configure-tauri-updater] OMNITERM_UPDATER_PUBKEY/ENDPOINT not set — leaving tauri.conf.json unconfigured (dev mode).')
  process.exit(0)
}

const conf = JSON.parse(readFileSync(confPath, 'utf8'))
conf.plugins = conf.plugins ?? {}
conf.plugins.updater = {
  active: true,
  dialog: false,
  pubkey,
  endpoints: [endpoint],
}
// Produces the .sig sidecar files the updater verifies against `pubkey`.
conf.bundle = conf.bundle ?? {}
conf.bundle.createUpdaterArtifacts = true

writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
console.log('[configure-tauri-updater] plugins.updater injected into', confPath)
