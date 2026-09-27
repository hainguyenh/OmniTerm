import path from 'node:path'

import type { ProviderDeps } from './deps'
import type { AgentKind } from './types'

import { profileEnv } from './cli'

/**
 * A profile launcher: a small script the user runs instead of the agent, such as `claude-th.cmd`
 * setting `CLAUDE_CONFIG_DIR` before starting `claude.exe`. Probing and waking through the same
 * launcher reproduces exactly how the user runs that profile — including launchers whose directory
 * does not follow the name (`claude-he` → `~/.claude-he`).
 *
 * Only a bare name crosses the IPC boundary. It must look like `claude-<x>` / `codex-<x>` and is
 * resolved here from the user's own bin directory and PATH, so the renderer can never make the
 * sidecar run an arbitrary file.
 */
const LAUNCHER_NAME = /^(claude|codex)-[A-Za-z0-9_.]{1,40}$/

export function isLauncherName(name: string, agent: AgentKind): boolean {
  return LAUNCHER_NAME.test(name) && name.startsWith(`${agent}-`)
}

export interface AgentCommand {
  exe: string
  env: NodeJS.ProcessEnv
}

const PROFILE_VARIABLE = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' } as const
export const DEFAULT_DIR = { claude: '.claude', codex: '.codex' } as const

/**
 * How to run `agent` for a profile: its launcher when the terminal used one (the launcher then sets
 * the profile variable itself, so ours is removed), otherwise the agent's CLI with the variable set
 * for a non-default profile.
 */
export function agentCommand(
  agent: AgentKind,
  profile: { profileDir?: string | null; launcher?: string | null },
  deps: ProviderDeps,
): AgentCommand | null {
  const variable = PROFILE_VARIABLE[agent]
  const defaultDir = path.join(deps.home, DEFAULT_DIR[agent])
  if (profile.launcher && isLauncherName(profile.launcher, agent)) {
    const exe = deps.resolveLauncher(profile.launcher)
    if (exe) return { exe, env: profileEnv(variable, null, defaultDir, deps.env) }
  }
  const exe = deps.resolve(agent)
  return exe ? { exe, env: profileEnv(variable, profile.profileDir, defaultDir, deps.env) } : null
}
