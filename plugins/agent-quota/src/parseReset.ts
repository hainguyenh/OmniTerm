/**
 * Reset times as agents print them, turned into epoch milliseconds.
 *
 * Claude prints wall-clock times in the account's zone — `Sep 25, 12:59pm (Asia/Ho_Chi_Minh)` —
 * so a bracketed IANA zone is honoured rather than stripped (the quota project treated it as local
 * time, which is wrong whenever the machine and the account disagree). Other accepted forms:
 * `tomorrow, 2:50am`, `today 14:30`, `3pm`, `in 2h 13m`, ISO 8601 and epoch seconds/milliseconds.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_MS = 86_400_000

interface CivilDate {
  year: number
  month: number
  day: number
}

function zoneOffsetMs(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(epoch))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - Math.floor(epoch / 1000) * 1000
}

function validZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

/** Epoch for a wall-clock time in `timeZone`, or in local time when no zone is given. */
export function zonedToEpoch(date: CivilDate, hour: number, minute: number, timeZone?: string): number {
  if (!timeZone) return new Date(date.year, date.month, date.day, hour, minute).getTime()
  const guess = Date.UTC(date.year, date.month, date.day, hour, minute)
  const first = guess - zoneOffsetMs(guess, timeZone)
  const second = guess - zoneOffsetMs(first, timeZone)
  return second
}

function civilToday(now: number, timeZone?: string): CivilDate {
  if (!timeZone) {
    const local = new Date(now)
    return { year: local.getFullYear(), month: local.getMonth(), day: local.getDate() }
  }
  const shifted = new Date(now + zoneOffsetMs(now, timeZone))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month, date.day) + days * DAY_MS)
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth(), day: moved.getUTCDate() }
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const match = /(?:^|[\s,])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=$|[\s,])/i.exec(text)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '')
  if (!meridiem && !match[2]) return null
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
  } else if (hour > 23) {
    return null
  }
  return { hour, minute }
}

function parseMonthDay(text: string): { month: number; day: number; rest: string } | null {
  const monthFirst = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text)
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b/i.exec(text)
  const pick = (name: string, day: string, match: RegExpExecArray) => {
    const month = MONTHS.indexOf(name.toLowerCase())
    const dayNumber = Number(day)
    if (month < 0 || dayNumber < 1 || dayNumber > 31) return null
    return { month, day: dayNumber, rest: text.replace(match[0], ' ') }
  }
  return (monthFirst && pick(monthFirst[1], monthFirst[2], monthFirst))
    ?? (dayFirst && pick(dayFirst[2], dayFirst[1], dayFirst))
    ?? null
}

function parseRelative(text: string, now: number): number | undefined {
  const match = /\bin\s+((?:\d+\s*(?:d|days?|h|hrs?|hours?|m|mins?|minutes?)\s*)+)/i.exec(text)
  if (!match) return undefined
  let total = 0
  for (const part of match[1].matchAll(/(\d+)\s*([dhm])/gi)) {
    const unit = part[2].toLowerCase()
    total += Number(part[1]) * (unit === 'd' ? DAY_MS : unit === 'h' ? 3_600_000 : 60_000)
  }
  return total > 0 ? now + total : undefined
}

/** Parse a reset description; `undefined` when nothing in it is a recognisable time. */
export function parseResetText(raw: string, now: number = Date.now()): number | undefined {
  const text = raw.trim().replace(/^resets?\s*(?:at|on)?\s*/i, '')
  if (!text) return undefined
  if (/^\d{10}$/.test(text)) return Number(text) * 1000
  if (/^\d{13}$/.test(text)) return Number(text)
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = Date.parse(text)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  const relative = parseRelative(text, now)
  if (relative !== undefined) return relative

  const zoneMatch = /\(([^)]+)\)/.exec(text)
  const timeZone = validZone(zoneMatch?.[1]?.trim())
  const body = zoneMatch ? text.replace(zoneMatch[0], ' ') : text
  const today = civilToday(now, timeZone)

  const monthDay = parseMonthDay(body)
  const clock = parseClock(monthDay ? monthDay.rest : body)
  if (monthDay) {
    const { hour, minute } = clock ?? { hour: 0, minute: 0 }
    let epoch = zonedToEpoch({ year: today.year, month: monthDay.month, day: monthDay.day }, hour, minute, timeZone)
    // A January reset read in December belongs to next year.
    if (epoch < now - DAY_MS) {
      epoch = zonedToEpoch({ year: today.year + 1, month: monthDay.month, day: monthDay.day }, hour, minute, timeZone)
    }
    return epoch
  }
  if (!clock) return undefined
  if (/\btomorrow\b/i.test(body)) return zonedToEpoch(addDays(today, 1), clock.hour, clock.minute, timeZone)
  const epoch = zonedToEpoch(today, clock.hour, clock.minute, timeZone)
  if (/\btoday\b/i.test(body)) return epoch
  // A bare time already past today means the same time tomorrow.
  return epoch < now - 60_000 ? zonedToEpoch(addDays(today, 1), clock.hour, clock.minute, timeZone) : epoch
}
