import type { QuotaWindow } from './usage/types'
import type { Zone } from './quotaPolicy'
import type { QuotaState } from './quotaStore'

import { effectiveConfig } from './quotaConfig'
import { formatReset, zoneFor } from './quotaPolicy'

/** One bar of a pane footer: a quota window, or how full the conversation's context is. */
export interface FooterMeter {
  key: 'session' | 'weekly' | 'context'
  label: string
  /** 0–100, rounded. */
  pct: number
  zone: Zone
  title: string
}

const WINDOW_METERS: ReadonlyArray<{ kind: 'session' | 'weekly'; label: string; name: string }> = [
  { kind: 'session', label: '5h', name: '5-hour quota' },
  { kind: 'weekly', label: 'wk', name: 'Weekly quota' },
]

const clampPct = (value: number) => Math.round(Math.min(100, Math.max(0, value)))

function windowTitle(name: string, window: QuotaWindow, limit: number, now: number): string {
  const when = formatReset(window.resetsAt, now)
  const reset = when ? `, resets ${when}` : ''
  return `${name}: ${clampPct(window.usedPct)}% used (limit ${limit}%)${reset}`
}

/**
 * The bars a pane's agent footer shows: the profile's 5-hour and weekly quota, coloured by how close
 * each is to its limit, then how full the context window is (its own zones run to 100%). The agent's
 * status line already prints these as text; the footer draws them as bars instead.
 */
export function footerMeters(
  state: Pick<QuotaState, 'config' | 'terminals' | 'profiles' | 'overrides'>,
  sessionId: string,
  contextPct: number | null,
  now: number,
): FooterMeter[] {
  const meters: FooterMeter[] = []
  const terminal = state.config.enabled ? state.terminals[sessionId] : undefined
  const reading = terminal ? state.profiles[terminal.profileKey]?.lastGood : undefined
  if (terminal && reading) {
    const config = effectiveConfig(state.config.agents[terminal.agent], state.overrides[terminal.instanceKey])
    for (const { kind, label, name } of WINDOW_METERS) {
      const window = reading.windows.find((item) => item.kind === kind)
      if (!window) continue
      const limit = config.limits[kind]
      meters.push({ key: kind, label, pct: clampPct(window.usedPct), zone: zoneFor(window.usedPct, limit), title: windowTitle(name, window, limit, now) })
    }
  }
  if (contextPct !== null) {
    const pct = clampPct(contextPct)
    meters.push({ key: 'context', label: 'ctx', pct, zone: zoneFor(pct, 100), title: `Context window: ${pct}% used` })
  }
  return meters
}

/** The pane footer's warning that sessions outside this pane spend the same quota. */
export interface FooterRisk {
  text: string
  title: string
}

/**
 * Shown while the profile is in danger (profileCensus.ts): more than one Claude session on this
 * machine, or a headless `claude -p`, spends its quota, so it is read every few minutes even while
 * this pane sits idle.
 */
export function footerRisk(state: Pick<QuotaState, 'config' | 'terminals' | 'profiles'>, sessionId: string): FooterRisk | null {
  const terminal = state.config.enabled ? state.terminals[sessionId] : undefined
  const profile = terminal ? state.profiles[terminal.profileKey] : undefined
  if (profile?.risk !== 'danger' || !profile.activity) return null
  const { sessions, headless } = profile.activity
  const runs = `${sessions} Claude session${sessions === 1 ? '' : 's'}`
  const quiet = headless > 0 ? `, ${headless} of them headless (claude -p, which the status line never sees)` : ''
  return {
    text: `×${sessions}`,
    title: `${runs} on this machine ${sessions === 1 ? 'uses' : 'use'} the ${profile.profileName} profile${quiet}: its quota is read every few minutes.`,
  }
}
