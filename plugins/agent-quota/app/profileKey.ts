import type { AgentKind } from '../src/types'
import type { SessionAgent } from './agentQuotaAPI'

/**
 * How one agent process maps to the profile whose quota it spends.
 *
 * The profile directory is the profile's identity: a launcher (`claude-work.cmd`) only sets it. So
 * a terminal started through the launcher and another where `claude` runs with the same directory
 * (a resume, a shell alias, an exported `CLAUDE_CONFIG_DIR`) share one profile. They used to be
 * keyed apart, which listed the profile twice and read the second copy without its launcher.
 *
 * Rust falls back to the agent's default directory when it cannot read the environment, so a
 * default directory does not identify a launcher's profile; the launcher name keys it then.
 */

/** Mirrors `DEFAULT_DIR` in src/launcher.ts, which is sidecar-only (it imports Node modules). */
const DEFAULT_PROFILE_DIR: Record<AgentKind, string> = { claude: '.claude', codex: '.codex', agy: '.gemini' }

/** Session + pid + start time: a new agent process in the same terminal is a new instance. */
export const instanceKeyOf = (agent: SessionAgent) => `${agent.sessionId}:${agent.pid}:${agent.startTime}`

function normalizeDir(dir: string): string {
  const lower = dir.trim().toLowerCase()
  const unified = /^[a-z]:[\\/]/.test(lower) ? lower.replace(/\//g, '\\') : lower
  return unified.replace(/[\\/]+$/, '')
}

function isDefaultDir(agent: AgentKind, dir: string): boolean {
  return dir.split(/[\\/]/).pop() === DEFAULT_PROFILE_DIR[agent]
}

export function profileKeyOf(agent: SessionAgent): string {
  const dir = agent.profileDir ? normalizeDir(agent.profileDir) : ''
  if (dir && !isDefaultDir(agent.agent, dir)) return `${agent.agent}:${dir}`
  if (agent.launcher) return `${agent.agent}:launcher:${agent.launcher.toLowerCase()}`
  return `${agent.agent}:${dir || agent.profileName.toLowerCase()}`
}
