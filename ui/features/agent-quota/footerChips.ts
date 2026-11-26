import type { AgentKind } from './usage/types'
import type { QuotaState } from './quotaStore'

export interface FooterChip {
  key: string
  /** Two-letter agent tag: Cl, Cx, Ag. */
  tag: string
  profileName: string
  /** Used percent of the most relevant window, or null while no reading exists. */
  usedPct: number | null
  /** The profile's agent is frozen or over its limit. */
  alert: boolean
}

const TAGS: Record<AgentKind, string> = { claude: 'Cl', codex: 'Cx', agy: 'Ag' }

/**
 * One chip per agent profile that has a running terminal. The session window is preferred because it
 * is the one that gates work; a profile without a reading still gets a chip so it is visibly tracked.
 */
export function footerChips(state: Pick<QuotaState, 'terminals' | 'profiles' | 'config'>, isHeld: (key: string) => boolean): FooterChip[] {
  const chips = new Map<string, FooterChip>()
  for (const terminal of Object.values(state.terminals)) {
    if (chips.has(terminal.profileKey)) continue
    const profile = state.profiles[terminal.profileKey]
    const snapshot = profile?.snapshot && !profile.snapshot.error ? profile.snapshot : profile?.lastGood
    const window = snapshot?.windows.find((item) => item.kind === 'session') ?? snapshot?.windows[0]
    const limit = state.config.agents[terminal.agent].limits[window?.kind ?? 'session']
    chips.set(terminal.profileKey, {
      key: terminal.profileKey,
      tag: TAGS[terminal.agent],
      profileName: terminal.profileName,
      usedPct: window ? Math.round(window.usedPct) : null,
      alert: isHeld(terminal.instanceKey) || (window !== undefined && window.usedPct >= limit),
    })
  }
  return [...chips.values()]
}
