/**
 * The agent quota commands' wire types, matching crates/app-core/src/agent_quota/types.rs.
 * Type-only, so it costs the bundle nothing.
 */

export type AgentKind = 'claude' | 'codex' | 'agy'

/** A quota window. `session` is the rolling ~5-hour window every provider has. */
export type WindowKind = 'session' | 'weekly' | 'monthly'

export interface QuotaWindow {
  kind: WindowKind
  /** 0–100. Providers that report "remaining" are converted before this point. */
  usedPct: number
  /** Epoch milliseconds, when the provider says. */
  resetsAt?: number
  /** Provider wording, e.g. "Current week (all models)". */
  label: string
  /** Per-model readings behind a split window; the window itself carries the highest. */
  breakdown?: Array<{ label: string; usedPct: number }>
}

/**
 * Where a reading came from. No source uses a token or the network; `statusline` is the
 * `rate_limits` Claude Code handed the OmniTerm status line bridge.
 */
export type QuotaSource = 'cli' | 'rollout' | 'statusline'

export type QuotaError = 'parse_failed' | 'timeout' | 'not_signed_in' | 'unsupported' | 'failed'

export interface QuotaCredits {
  balance: number | null
  unlimited: boolean
}

/**
 * One reading of a profile's quota. A snapshot with `error` carries no windows the guard may act
 * on: stale or unparsed data must never suspend an agent.
 */
export interface QuotaSnapshot {
  windows: QuotaWindow[]
  fetchedAt: number
  source?: QuotaSource
  credits?: QuotaCredits
  error?: QuotaError
  message?: string
}

export interface FetchUsageRequest {
  agent: AgentKind
  profileDir?: string | null
  /** Name of the profile launcher the user ran (e.g. `claude-th`), resolved by name only. */
  launcher?: string | null
  modelFamily?: 'auto' | 'gemini' | 'claude' | null
  /**
   * Claude: the oldest status line record the read still takes, in ms; an older one sends it to
   * `claude -p /usage`. Absent: the record at any age (profileCensus.ts decides).
   */
  maxRecordAgeMs?: number
}

export interface WakeRequest {
  agent: AgentKind
  profileDir?: string | null
  launcher?: string | null
  prompt: string
}

export interface WakeResult {
  ok: boolean
  message?: string
}

/** A profile the user can start, found by `agent_quota_list_profiles` (default dir or launcher). */
export interface DiscoveredProfile {
  agent: AgentKind
  /** `claude` for the default profile, else the launcher name. */
  profileName: string
  /** The default profile's directory; null for a launcher, which sets its own. */
  profileDir: string | null
  launcher: string | null
}
