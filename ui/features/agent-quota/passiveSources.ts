import type { AgentKind, DiscoveredProfile, FetchUsageRequest } from './usage/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'

/**
 * Which profiles report their quota by themselves (`agent_quota_ensure_passive`): Claude and
 * Antigravity through the OmniTerm status line bridge, installed into a profile the first time it is
 * asked about; Codex through the session log it writes after every turn. Such a profile's agent is
 * neither frozen at launch nor typed into: its quota comes from that source and the background
 * read. Any other profile keeps the inline probe as its fallback.
 *
 * Only "yes" is remembered. A "no" is asked again at the next launch, since a Codex log or a fixed
 * settings.json can turn it into a yes.
 */
export class PassiveSources {
  private readonly passive = new Set<string>()
  /** Per agent: every profile discovered at start-up reports by itself, so a launch needs no hold. */
  private readonly allPassive = new Set<AgentKind>()
  private primed = false

  constructor(private readonly api: AgentQuotaAPI) {}

  /** Once, when Agent Quota runs: install the bridges into every discovered profile of `agents`. */
  async prime(agents: readonly AgentKind[]): Promise<void> {
    if (this.primed || !this.api.ensurePassive || !this.api.listProfiles) return
    this.primed = true
    const profiles = await this.api.listProfiles().catch((): DiscoveredProfile[] => [])
    for (const agent of agents) {
      const own = profiles.filter((profile) => profile.agent === agent)
      if (own.length === 0) continue
      const answers = await Promise.all(own.map((profile) => this.check(profile)))
      if (answers.every(Boolean)) this.allPassive.add(agent)
    }
  }

  /** Whether a launch of `agent` can skip the hold, before its profile is even known. */
  agentIsPassive(agent: AgentKind): boolean {
    return this.allPassive.has(agent)
  }

  async check(request: FetchUsageRequest & { profileDir: string | null }): Promise<boolean> {
    const key = `${request.agent}|${request.profileDir ?? ''}|${request.launcher ?? ''}`.toLowerCase()
    if (this.passive.has(key)) return true
    const answer = await this.api.ensurePassive?.(request).catch(() => false) ?? false
    if (answer) this.passive.add(key)
    else this.allPassive.delete(request.agent)
    return answer
  }
}
