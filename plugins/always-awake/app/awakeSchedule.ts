/**
 * The Always Awake schedule vocabulary: the three offered durations, the instant each resolves to,
 * and how to read a stored deadline back as one of them.
 *
 * Separate from the modal because the backend persists only `expiresAtMs` — turning that number back
 * into a schedule is a rule worth testing on its own, and a component file cannot export it without
 * breaking React Fast Refresh.
 */

export type Duration = 'today' | '24h' | 'nextMonday'

export const DURATIONS: readonly (readonly [Duration, string])[] = [
  ['today', 'Today'],
  ['24h', '24 hours'],
  ['nextMonday', 'Mon 08:00'],
]

export function expiryFor(duration: Duration): number {
  const now = new Date()
  if (duration === '24h') return now.getTime() + 24 * 60 * 60 * 1000
  if (duration === 'today') {
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return end.getTime()
  }
  const next = new Date(now)
  const days = ((1 - next.getDay() + 7) % 7) || 7
  next.setDate(next.getDate() + days)
  next.setHours(8, 0, 0, 0)
  return next.getTime()
}

/**
 * Which schedule a stored deadline came from.
 *
 * Reopening the modal used to fall back to the `24h` default no matter what was saved, so the panel
 * claimed a schedule the machine was not running. `today` and `nextMonday` are absolute instants and
 * can be recognised exactly; anything else — including a rolling 24 hours — reports as `24h`.
 */
export function durationFromExpiry(status: AlwaysAwakeStatus): Duration {
  if (!status.enabled || status.expiresAtMs <= 0) return '24h'
  if (status.expiresAtMs === expiryFor('today')) return 'today'
  if (status.expiresAtMs === expiryFor('nextMonday')) return 'nextMonday'
  return '24h'
}

/** The deadline as the user reads it, so a changed schedule is visibly different. */
export function formatDeadline(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
