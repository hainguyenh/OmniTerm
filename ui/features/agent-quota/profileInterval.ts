import type { ProfileQuota } from './quotaStore'

import { pressure, windowOf } from './quotaPolicy'
import { getQuotaState, terminalConfig } from './quotaStore'
import { guardInterval, heldInterval, nextInterval } from './smartInterval'

/**
 * How long until this profile's next read: fast while a guard watches it, parked until the reset
 * while every terminal on it is suspended, otherwise the smart interval from its usage history.
 */
export function intervalForProfile(
  profile: ProfileQuota,
  busy: Readonly<Record<string, boolean>>,
  random: () => number,
  now: number,
): number {
  const state = getQuotaState()
  const terminals = Object.values(state.terminals).filter((terminal) => terminal.profileKey === profile.key)
  const guards = terminals.map((terminal) => state.guards[terminal.instanceKey])
  if (guards.some((guard) => guard?.phase === 'guarding')) return guardInterval(random)
  const configs = terminals.map((terminal) => terminalConfig(state, terminal))
  if (terminals.length > 0 && guards.every((guard) => guard?.phase === 'suspended')) {
    const resumeTimes = guards.flatMap((guard, index) =>
      guard?.resetsAt === undefined ? [] : [guard.resetsAt + configs[index].resumeDelayMinutes * 60_000])
    return heldInterval(resumeTimes.length > 0 ? Math.min(...resumeTimes) : undefined, now)
  }
  const reading = profile.lastGood
  const session = windowOf(reading, 'session')
  const sessionLimit = Math.min(...configs.map((config) => config.limits.session), 100)
  return nextInterval({
    history: profile.history,
    pressure: Math.max(0, ...configs.map((config) => pressure(reading, config))),
    headroom: sessionLimit - (session?.usedPct ?? 0),
    busy: terminals.some((terminal) => busy[terminal.sessionId]),
    errorStreak: profile.errorStreak,
    now,
    random,
  })
}
