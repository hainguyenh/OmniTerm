import type { AgentKind, QuotaWindow } from '../../features/agent-quota/usage/types'
import { AGENT_KINDS } from '../../features/agent-quota/quotaConfig'
import { formatReset } from '../../features/agent-quota/quotaPolicy'
import type { QuotaState } from '../../features/agent-quota/quotaStore'

/** Agent names as the workbench shows them (the mock's "Claude", "Codex", "Gemini"). */
export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' }
/** Two-letter tags of the tab strip line. */
export const AGENT_TAGS: Record<AgentKind, string> = { claude: 'Cl', codex: 'Cx', agy: 'Ag' }

const WINDOW_NAMES: Record<QuotaWindow['kind'], string> = { session: '5h window', weekly: 'weekly', monthly: 'monthly' }

export interface QuotaProfileRow {
  key: string
  name: string
  /** Used percent of the session window (else the first one), or null before the first reading. */
  pct: number | null
  /** "5h window · resets 14:20". */
  detail: string
  /** The profile the active session runs on. */
  active: boolean
}

export interface QuotaAgentGroup {
  agent: AgentKind
  name: string
  tag: string
  profiles: QuotaProfileRow[]
  /** The active session runs this agent. */
  active: boolean
  /** The row the strip line and footer show: the active session's profile, else the first one. */
  shown: QuotaProfileRow
}

export interface ActiveQuotaSession {
  sessionId: string
  agent: AgentKind
  profileKey: string
  profileName: string
}

/** The agent running in the given session (the active editor tab), if quota tracks one there. */
export function activeQuotaSession(state: Pick<QuotaState, 'terminals'>, sessionId: string | null): ActiveQuotaSession | null {
  if (!sessionId) return null
  const terminal = Object.values(state.terminals).find((item) => item.sessionId === sessionId)
  return terminal
    ? { sessionId, agent: terminal.agent, profileKey: terminal.profileKey, profileName: terminal.profileName }
    : null
}

/** The window a row shows: the session window, else the first one of the last good reading. */
function shownWindow(profile: QuotaState['profiles'][string]): QuotaWindow | undefined {
  const snapshot = profile.snapshot && !profile.snapshot.error ? profile.snapshot : profile.lastGood
  return snapshot?.windows.find((item) => item.kind === 'session') ?? snapshot?.windows[0]
}

/**
 * The soonest reset among the rows' windows still ahead of `now`: the rows' text changes by the
 * second only near it, so the status bar can follow a coarse clock until then.
 */
export function nearestReset(profiles: QuotaState['profiles'], now: number): number | undefined {
  let nearest: number | undefined
  for (const profile of Object.values(profiles)) {
    const at = shownWindow(profile)?.resetsAt
    if (at !== undefined && at > now && (nearest === undefined || at < nearest)) nearest = at
  }
  return nearest
}

function usageOf(profile: QuotaState['profiles'][string], now: number): { pct: number | null; detail: string } {
  const window = shownWindow(profile)
  if (!window) return { pct: null, detail: profile.fetching ? 'reading…' : 'no reading yet' }
  const reset = formatReset(window.resetsAt, now)
  return {
    pct: Math.max(0, Math.min(100, Math.round(window.usedPct))),
    detail: [WINDOW_NAMES[window.kind], reset && `resets ${reset}`].filter(Boolean).join(' · '),
  }
}

/** One group per agent with known profiles, in the plugin's agent order. */
export function quotaGroups(
  state: Pick<QuotaState, 'profiles'> & { now: number },
  active: ActiveQuotaSession | null,
): QuotaAgentGroup[] {
  const groups: QuotaAgentGroup[] = []
  for (const agent of AGENT_KINDS) {
    const profiles = Object.values(state.profiles)
      .filter((profile) => profile.agent === agent)
      .sort((a, b) => a.profileName.localeCompare(b.profileName))
      .map((profile): QuotaProfileRow => ({
        key: profile.key,
        name: profile.profileName,
        ...usageOf(profile, state.now),
        active: active?.profileKey === profile.key,
      }))
    if (profiles.length === 0) continue
    groups.push({
      agent,
      name: AGENT_NAMES[agent],
      tag: AGENT_TAGS[agent],
      profiles,
      active: active?.agent === agent,
      shown: profiles.find((row) => row.active) ?? profiles[0],
    })
  }
  return groups
}

export interface QuotaFooterProfile {
  key: string
  agent: AgentKind
  /** The profile name, with the agent's tag when another agent has a profile of the same name. */
  label: string
  /** Used percent of the row's window (the 5h one when known), or null before the first reading. */
  pct: number | null
  /** "Claude · 5h window · resets 14:20", for the tooltip. */
  detail: string
  /** The active session runs on this profile. */
  active: boolean
}

/** How close a profile is to its 5h limit, for ordering: the session window, else no urgency. */
function sessionUrgency(profile: QuotaState['profiles'][string]): number {
  const window = shownWindow(profile)
  return window?.kind === 'session' ? window.usedPct : -1
}

/**
 * The footer's profiles: those with a running agent (every known one while none runs), the one
 * nearest its 5h limit first. When the bar is too narrow the tail is what gets hidden, so the
 * profiles about to run out stay in sight.
 */
export function footerProfiles(
  state: Pick<QuotaState, 'terminals' | 'profiles'> & { now: number },
  active: ActiveQuotaSession | null,
): QuotaFooterProfile[] {
  const running = new Set(Object.values(state.terminals).map((terminal) => terminal.profileKey))
  const all = Object.values(state.profiles)
  const shown = all.some((profile) => running.has(profile.key)) ? all.filter((profile) => running.has(profile.key)) : all
  const agentsByName = new Map<string, Set<AgentKind>>()
  for (const profile of shown) {
    const agents = agentsByName.get(profile.profileName) ?? new Set<AgentKind>()
    agents.add(profile.agent)
    agentsByName.set(profile.profileName, agents)
  }
  return shown
    .map((profile) => ({ profile, urgency: sessionUrgency(profile) }))
    .sort((a, b) => b.urgency - a.urgency || a.profile.profileName.localeCompare(b.profile.profileName))
    .map(({ profile }): QuotaFooterProfile => {
      const usage = usageOf(profile, state.now)
      const shared = (agentsByName.get(profile.profileName)?.size ?? 0) > 1
      return {
        key: profile.key,
        agent: profile.agent,
        label: shared ? `${profile.profileName} (${AGENT_TAGS[profile.agent]})` : profile.profileName,
        pct: usage.pct,
        detail: `${AGENT_NAMES[profile.agent]} · ${usage.detail}`,
        active: active?.profileKey === profile.key,
      }
    })
}

/** Bar colour by usage, as in the mock: green, amber over 50%, red over 80%. */
export function usageColor(pct: number | null): string {
  if (pct === null) return 'var(--border-strong)'
  if (pct > 80) return 'var(--danger)'
  if (pct > 50) return 'var(--warning)'
  return 'var(--success)'
}
