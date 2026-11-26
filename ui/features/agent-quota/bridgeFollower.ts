import type { FetchUsageRequest, QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { ProfileQuota } from './quotaStore'

import { isNewBridgeRecord } from './quotaReading'
import { getQuotaState } from './quotaStore'

/**
 * How often each profile's status line bridge record is looked at. Claude Code and the
 * Antigravity CLI rewrite it whenever they render their status line (Claude at most every 300 ms),
 * and a look is one small file read, never a CLI run.
 */
export const BRIDGE_POLL_MS = 2_000

/**
 * Follows the status line bridges (crates/app-core/src/agent_quota/claude_bridge.rs, agy_bridge.rs)
 * so a profile's quota moves as soon as its agent reports it — the same numbers, at the same time,
 * as the agent's own status line — instead of at the next background read minutes later. Only a
 * record that is news counts (`isNewBridgeRecord`); Codex has no bridge.
 */
export class BridgeFollower {
  private readonly due = new Map<string, number>()
  private readonly reading = new Set<string>()

  constructor(
    private readonly api: AgentQuotaAPI,
    private readonly requestFor: (profile: ProfileQuota) => FetchUsageRequest,
    private readonly apply: (key: string, snapshot: QuotaSnapshot) => Promise<void>,
  ) {}

  /** Look at every monitored profile whose turn has come; each look is handed to `track`. */
  poll(now: number, monitored: (profileKey: string) => boolean, track: (work: Promise<void>) => void): void {
    const read = this.api.readBridge
    if (!read) return
    const profiles = getQuotaState().profiles
    for (const key of this.due.keys()) {
      if (!profiles[key]) this.due.delete(key)
    }
    for (const profile of Object.values(profiles)) {
      if (profile.agent === 'codex' || this.reading.has(profile.key)) continue
      if (now < (this.due.get(profile.key) ?? 0) || !monitored(profile.key)) continue
      this.due.set(profile.key, now + BRIDGE_POLL_MS)
      this.reading.add(profile.key)
      track(this.follow(read, profile).finally(() => this.reading.delete(profile.key)))
    }
  }

  private async follow(read: NonNullable<AgentQuotaAPI['readBridge']>, profile: ProfileQuota): Promise<void> {
    const snapshot = await read(this.requestFor(profile)).catch(() => null)
    if (!snapshot || snapshot.error || snapshot.windows.length === 0) return
    const current = getQuotaState().profiles[profile.key]
    if (!current || !isNewBridgeRecord(snapshot, current)) return
    await this.apply(profile.key, snapshot)
  }
}
