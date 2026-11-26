import type { FetchUsageRequest } from './usage/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { ProfileQuota, TerminalAgent } from './quotaStore'

import { normalizeDir } from './profileKey'
import { FRESH_MS } from './quotaPolicy'
import { getQuotaState } from './quotaStore'

/**
 * How closely a Claude profile's quota is read, from how many Claude sessions spend it on this
 * machine — in any terminal or app, not only OmniTerm's panes (`agent_quota_profile_census`,
 * src-tauri/src/agent_quota/agent_census.rs).
 *
 * Walking the whole process table and reading each Claude process's environment is not free, so the
 * census is taken only when a Claude agent starts in a pane (and once at start-up for those already
 * running), never on a timer. Between two, OmniTerm's own panes are followed by the pane detection
 * the engine runs anyway; the sessions outside them are taken as the census saw them, for
 * `CENSUS_TTL_MS`. A limit reached needs no census either: the suspend looks across the machine for
 * the profile's processes itself (`suspend_targets_for_profile` in agent_guard.rs).
 *
 *  - `danger`: two or more sessions, or a headless `claude -p`. A pane that sits idle says nothing
 *    then: another session may be spending the same quota, and a headless run renders no status
 *    line, so the bridge never reports what it spends. The bridge record may be at most
 *    `DANGER_RECORD_MS` old before `claude -p /usage` is asked, and reads come at the busy pace.
 *  - `active`: the profile's one session is working. Its status line keeps the record fresh; the
 *    CLI is asked only when the record is older than `FRESH_MS` (a long tool run without a reply).
 *  - `idle`: one session, idle. Nothing can spend the quota, so nothing is read: the bridge still
 *    reports the moment the session replies (bridgeFollower.ts).
 *  - `unknown`: no census, one older than `CENSUS_TTL_MS`, or a profile whose folder is unknown (a
 *    launcher Rust could not see into), so other sessions cannot be ruled out: read as before, from
 *    the record at any age (a small file read) and the CLI only without one.
 */
export type UsageRisk = 'unknown' | 'idle' | 'active' | 'danger'

/** The Claude sessions of one profile on this machine. */
export interface ProfileCensus {
  /** Null for sessions whose environment Rust could not read: their profile is unknown. */
  profileDir: string | null
  sessions: number
  /** Of those, the ones started with `-p`/`--print`. */
  headless: number
}

export interface ProfileActivity {
  sessions: number
  headless: number
}

/** How long the sessions a census saw outside the panes are trusted to still be there. */
export const CENSUS_TTL_MS = 15 * 60_000
/** While a profile is in danger, its bridge record may be this old before the CLI is asked. */
export const DANGER_RECORD_MS = 2 * 60_000
/** An idle profile's plan is made again this soon; making it reads nothing. */
export const IDLE_RECHECK_MS = 30_000

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Validate the census payload; malformed rows are dropped rather than trusted. */
export function parseProfileCensus(value: unknown): ProfileCensus[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): ProfileCensus[] => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return []
    const { agent, profileDir, sessions, headless } = row as Record<string, unknown>
    if (agent !== 'claude' || !isCount(sessions) || !isCount(headless) || headless > sessions) return []
    if (profileDir !== null && typeof profileDir !== 'string') return []
    return [{ profileDir, sessions, headless }]
  })
}

/** What one census found. */
export interface CensusView {
  at: number
  rows: readonly ProfileCensus[]
  /** OmniTerm's Claude panes per profile folder (`normalizeDir`) when the census was taken. */
  panesAt: Readonly<Record<string, number>>
}

/**
 * The sessions spending this profile's quota, matched on its folder however it is spelt: those the
 * census saw outside OmniTerm's panes, plus the panes running it now. Null when that cannot be
 * known: no census, one too old, or no folder to match.
 */
export function activityOf(profile: Pick<ProfileQuota, 'profileDir'>, census: CensusView | null, panes: number, now: number): ProfileActivity | null {
  if (!census || !profile.profileDir || now - census.at > CENSUS_TTL_MS) return null
  const dir = normalizeDir(profile.profileDir)
  const row = census.rows.find((entry) => entry.profileDir !== null && normalizeDir(entry.profileDir) === dir)
  const outside = Math.max(0, (row?.sessions ?? 0) - (census.panesAt[dir] ?? 0))
  return { sessions: outside + panes, headless: row?.headless ?? 0 }
}

export function usageRisk(activity: ProfileActivity | null, working: boolean): UsageRisk {
  if (!activity) return 'unknown'
  if (activity.headless > 0 || activity.sessions >= 2) return 'danger'
  return working ? 'active' : 'idle'
}

export interface UsagePlan {
  risk: UsageRisk
  activity: ProfileActivity | null
  /** False: nothing is read this time; the plan is made again after `IDLE_RECHECK_MS`. */
  read: boolean
  request: Pick<FetchUsageRequest, 'maxRecordAgeMs'>
}

/** Whether to read the profile's quota now, and how young its bridge record must be. */
export function planUsageRead(profile: Pick<ProfileQuota, 'lastGood'>, activity: ProfileActivity | null, working: boolean): UsagePlan {
  const risk = usageRisk(activity, working)
  switch (risk) {
    // Without any reading yet, one read is taken: the record at any age, or the CLI once.
    case 'idle': return { risk, activity, read: !profile.lastGood, request: {} }
    case 'active': return { risk, activity, read: true, request: { maxRecordAgeMs: FRESH_MS } }
    case 'danger': return { risk, activity, read: true, request: { maxRecordAgeMs: DANGER_RECORD_MS } }
    default: return { risk, activity, read: true, request: {} }
  }
}

function panesByDir(terminals: readonly TerminalAgent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const terminal of terminals) {
    if (terminal.agent !== 'claude' || !terminal.profileDir) continue
    const dir = normalizeDir(terminal.profileDir)
    counts[dir] = (counts[dir] ?? 0) + 1
  }
  return counts
}

/** Takes the census when Claude agents start in panes, and plans each profile's reads from it. */
export class CensusWatcher {
  private view: CensusView | null = null
  /** The Claude pane agents (`instanceKey`) already counted. */
  private seen = new Set<string>()
  private reading = false
  /** Agents that started while a census was under way: one more is taken once it answers. */
  private queued: { now: number; terminals: readonly TerminalAgent[] } | null = null

  constructor(private readonly api: AgentQuotaAPI) {}

  /** Called with every pane agent after each detection: takes the census once a Claude agent is new. */
  noteAgents(now: number, terminals: readonly TerminalAgent[], track: (work: Promise<void>) => void): void {
    const claude = terminals.filter((terminal) => terminal.agent === 'claude').map((terminal) => terminal.instanceKey)
    const started = claude.some((key) => !this.seen.has(key))
    this.seen = new Set(claude)
    if (started) this.take(now, terminals, track)
  }

  private take(now: number, terminals: readonly TerminalAgent[], track: (work: Promise<void>) => void): void {
    const census = this.api.census
    if (!census) return
    if (this.reading) {
      this.queued = { now, terminals }
      return
    }
    this.reading = true
    const panesAt = panesByDir(terminals)
    track(census().then(
      (rows) => { this.view = { at: now, rows, panesAt } },
      () => { this.view = null },
    ).finally(() => {
      this.reading = false
      const next = this.queued
      this.queued = null
      if (next) this.take(next.now, next.terminals, track)
    }))
  }

  /** A guarded or busy pane counts as working; Codex and Antigravity are read as before. */
  plan(profile: ProfileQuota, terminals: readonly TerminalAgent[], busy: Readonly<Record<string, boolean>>, now: number): UsagePlan {
    if (profile.agent !== 'claude') return { risk: 'unknown', activity: null, read: true, request: {} }
    const guards = getQuotaState().guards
    const working = terminals.some((terminal) => busy[terminal.sessionId] || guards[terminal.instanceKey] !== undefined)
    return planUsageRead(profile, activityOf(profile, this.view, terminals.length, now), working)
  }
}
