import { invoke } from '@tauri-apps/api/core'

import type { DiscoveredProfile } from './usage/types'

/**
 * The status line bridge of one profile (`agent_quota_<agent>_bridge_*`): whether Claude Code runs
 * OmniTerm as that profile's status line and sub-agent guard, or the Antigravity CLI as its status
 * line. See crates/app-core/src/agent_quota/claude_bridge_install.rs and agy_bridge_install.rs.
 * Agent Quota installs it by itself the first time it sees a profile; a removal here sticks.
 */
export interface ClaudeBridgeStatus {
  /** Both the status line and the guard hook point at an OmniTerm. */
  installed: boolean
  /** They point at this OmniTerm; false while installed means another copy (an older install). */
  current: boolean
  /** The profile's earlier status line is still shown, through the bridge. */
  wrapsStatusLine: boolean
  /** The profile's settings.json is not valid JSON, so it is left alone. */
  unreadable: boolean
}

export type ClaudeBridgeResult = { ok: true; status: ClaudeBridgeStatus } | { ok: false; message: string }

const flag = (value: Record<string, unknown>, key: string) => value[key] === true

/** Validate a bridge status from Rust; anything malformed is no status at all. */
export function parseClaudeBridgeStatus(value: unknown): ClaudeBridgeStatus | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.installed !== 'boolean') return null
  return {
    installed: record.installed,
    current: flag(record, 'current'),
    wrapsStatusLine: flag(record, 'wrapsStatusLine'),
    unreadable: flag(record, 'unreadable'),
  }
}

type BridgeCommand = 'status' | 'install' | 'remove'

/** The agents with a status line bridge. */
export type BridgeAgent = 'claude' | 'agy'

const BRIDGE_AGENTS: Record<BridgeAgent, { name: string; usage: string }> = {
  claude: { name: 'Claude', usage: 'claude /usage' },
  agy: { name: 'Antigravity', usage: 'agy /usage' },
}

/** Run one bridge command for a profile folder; errors come back as a short message. */
export function claudeBridge(command: BridgeCommand, profileDir: string, agent: BridgeAgent = 'claude'): Promise<ClaudeBridgeResult> {
  return invoke<unknown>(`agent_quota_${agent}_bridge_${command}`, { profileDir }).then(
    (value): ClaudeBridgeResult => {
      const status = parseClaudeBridgeStatus(value)
      return status ? { ok: true, status } : { ok: false, message: 'No answer.' }
    },
    (error: unknown): ClaudeBridgeResult => ({ ok: false, message: String(error).slice(0, 300) }),
  )
}

export interface ProfileRow {
  agent: BridgeAgent
  name: string
  dir: string
}

export const rowKey = (row: ProfileRow) => `${row.agent}:${row.dir.toLowerCase()}`

export const bridgeAgentName = (agent: BridgeAgent) => BRIDGE_AGENTS[agent].name

const isBridgeAgent = (agent: string): agent is BridgeAgent => agent in BRIDGE_AGENTS

/** Claude and Antigravity profiles with a known folder: a launcher without one sets its own. */
export function bridgeRows(profiles: DiscoveredProfile[]): ProfileRow[] {
  const seen = new Set<string>()
  return profiles.flatMap((profile) => {
    if (!isBridgeAgent(profile.agent) || !profile.profileDir) return []
    const row: ProfileRow = { agent: profile.agent, name: profile.profileName, dir: profile.profileDir }
    if (seen.has(rowKey(row))) return []
    seen.add(rowKey(row))
    return [row]
  })
}

/** What one profile's row says about its bridge. */
export function bridgeLabel(status: ClaudeBridgeStatus | null, agent: BridgeAgent = 'claude'): string {
  if (!status) return 'Checking…'
  if (status.unreadable) return 'settings.json is not valid JSON — left alone'
  if (!status.installed) return `Not installed: quota read with ${BRIDGE_AGENTS[agent].usage}`
  if (!status.current) return 'Installed by another OmniTerm copy — update to use this one'
  return status.wrapsStatusLine ? 'Installed · your earlier status line still shows' : 'Installed'
}
