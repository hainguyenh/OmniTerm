/**
 * The Always Awake schedule vocabulary: the three offered schedules — a number of hours from now
 * (10 unless the user changes it), the rest of today, or a custom deadline the user picks (08:00
 * tomorrow unless they change it) — and how to read a stored deadline back as one of them.
 *
 * Separate from the modal because the backend persists only `expiresAtMs` — turning that number back
 * into a schedule is a rule worth testing on its own, and a component file cannot export it without
 * breaking React Fast Refresh.
 */

export type Duration = 'hours' | 'today' | 'custom'

export const DURATIONS: readonly (readonly [Duration, string])[] = [
  ['hours', 'Hours'],
  ['today', 'Today'],
  ['custom', 'Custom'],
]

/** The hours offered before the user types a number. */
export const DEFAULT_HOURS = 10
/** A week: anything longer is a date, better picked as a custom deadline. */
export const MAX_HOURS = 168

export function endOfToday(now = new Date()): number {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

/** The custom deadline offered before the user picks one: 08:00 tomorrow. */
export function defaultCustomExpiry(now = new Date()): number {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(8, 0, 0, 0)
  return next.getTime()
}

export interface Schedule {
  duration: Duration
  /** Hours from the moment of saving, for the Hours schedule. */
  hours: number
  /** The custom deadline, kept even while Today is selected so switching back does not lose it. */
  customAt: number
}

/**
 * Which schedule a stored deadline came from. The end of today is recognised exactly; any other
 * deadline still ahead is a custom one and is shown as such. With nothing running, the panel opens
 * on Custom at its 08:00-tomorrow default.
 */
export function scheduleFromStatus(status: AlwaysAwakeStatus, now = Date.now()): Schedule {
  const running = status.enabled && status.expiresAtMs > now
  if (running && status.expiresAtMs === endOfToday(new Date(now))) {
    return { duration: 'today', hours: DEFAULT_HOURS, customAt: defaultCustomExpiry(new Date(now)) }
  }
  return { duration: 'custom', hours: DEFAULT_HOURS, customAt: running ? status.expiresAtMs : defaultCustomExpiry(new Date(now)) }
}

/** Whether a typed number of hours can be saved: more than nothing, at most a week. */
export const validHours = (hours: number) => Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS

/** The deadline a schedule saves; null when the hours are out of range or a custom one is past. */
export function expiryFor(schedule: Schedule, now = Date.now()): number | null {
  if (schedule.duration === 'hours') return validHours(schedule.hours) ? now + Math.round(schedule.hours * 3_600_000) : null
  if (schedule.duration === 'today') return endOfToday(new Date(now))
  return Number.isFinite(schedule.customAt) && schedule.customAt > now ? schedule.customAt : null
}

const pad = (value: number) => String(value).padStart(2, '0')

/** An instant as a `datetime-local` input value, in local time to the minute. */
export function toLocalInput(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A `datetime-local` value back to an instant; NaN when it is empty or malformed. */
export function fromLocalInput(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return Number.NaN
  const [, year, month, day, hour, minute] = match.map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
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
