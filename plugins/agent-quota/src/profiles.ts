import path from 'node:path'

import type { ProviderDeps } from './deps'
import type { AgentKind, DiscoveredProfile } from './types'

import { DEFAULT_DIR, isLauncherName } from './launcher'

/** Claude only for now: codex profiles are not offered until their quota reading is supported. */
const AGENTS: readonly AgentKind[] = ['claude']
/** Only launchers the sidecar can run again by name (see deps.launcherCandidates) are listed. */
const WINDOWS_LAUNCHER_EXTENSIONS = ['.cmd', '.bat', '.exe']
/** A PATH with hundreds of `claude-*` files is not a real setup; the dashboard stays readable. */
const MAX_PROFILES = 50

/** `claude-work.CMD` → `claude-work` on Windows; unix launchers are extensionless scripts. */
function launcherBase(file: string, platform: NodeJS.Platform): string | null {
  if (platform !== 'win32') return file
  const ext = path.extname(file).toLowerCase()
  return WINDOWS_LAUNCHER_EXTENSIONS.includes(ext) ? file.slice(0, -ext.length) : null
}

/** An unreadable PATH entry or profile directory is skipped, never fatal to the whole listing. */
async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

/** Case-insensitive, then ordinal: the same order on every machine, whatever its locale. */
function byName(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a !== b) return a < b ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function searchDirs(deps: ProviderDeps, platform: NodeJS.Platform): string[] {
  const separator = platform === 'win32' ? ';' : ':'
  const fromPath = (deps.env.PATH ?? deps.env.Path ?? '').split(separator).map((dir) => dir.trim()).filter(Boolean)
  const seen = new Set<string>()
  return [path.join(deps.home, '.local', 'bin'), ...fromPath].filter((dir) => {
    const key = platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Every agent profile this user can start: each agent's default profile when its directory exists
 * (`~/.claude`), then every profile launcher (`claude-work`) found in
 * `~/.local/bin` or on PATH — the same places `resolveLauncher` looks, so each listed launcher can
 * be probed by name. Names are matched with the launcher rule, never executed here, and
 * de-duplicated the way the OS resolves them (case-insensitively on Windows).
 */
export async function listProfiles(deps: ProviderDeps, platform: NodeJS.Platform = process.platform): Promise<DiscoveredProfile[]> {
  const defaults: DiscoveredProfile[] = []
  for (const agent of AGENTS) {
    const dir = path.join(deps.home, DEFAULT_DIR[agent])
    if ((await safely(() => deps.mtime(dir), null)) !== null) defaults.push({ agent, profileName: agent, profileDir: dir, launcher: null })
  }

  const listings = await Promise.all(searchDirs(deps, platform).map((dir) => safely(() => deps.listDir(dir), [])))
  const launchers = new Map<string, DiscoveredProfile>()
  for (const file of listings.flat()) {
    const base = launcherBase(file, platform)
    const agent = base ? AGENTS.find((kind) => isLauncherName(base, kind)) : undefined
    if (!base || !agent) continue
    const key = platform === 'win32' ? base.toLowerCase() : base
    if (!launchers.has(key)) launchers.set(key, { agent, profileName: base, profileDir: null, launcher: base })
  }
  const sorted = [...launchers.values()].sort((left, right) => byName(left.profileName, right.profileName))
  return [...defaults, ...sorted].slice(0, MAX_PROFILES)
}
