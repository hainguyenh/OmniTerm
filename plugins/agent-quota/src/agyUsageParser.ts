import type { QuotaError, QuotaWindow, WindowKind } from './types'

import { parseResetText } from './parseReset'

export type AgyUsageParse =
  | { ok: true; windows: QuotaWindow[] }
  | { ok: false; error: QuotaError; message: string }

interface AgyReading {
  kind: WindowKind
  model: string
  usedPct: number
  resetsAt?: number
}

const NOT_SIGNED_IN = /(?:please\s+run\s+\/login|not\s+logged\s+in|login\s+required|unauthorized|invalid\s+api\s+key|oauth\s+token\s+has\s+expired|sign\s+in)/i

const PERCENT_PATTERN = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(used|left|remaining)?/i
const ISO_TIMESTAMP = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/i

const SESSION_PATTERN = /\b(?:five[-\s]hour|5[-\s]?h(?:ou)?r?|session)(?:\s+limit)?(?:\s+(?:remaining|used|left))?\b/i
const WEEKLY_PATTERN = /\b(?:week(?:ly)?|7[-\s]?days?)(?:\s+limit)?(?:\s+(?:remaining|used|left))?\b/i
const MONTHLY_PATTERN = /\b(?:month(?:ly)?)(?:\s+limit)?(?:\s+(?:remaining|used|left))?\b/i

/** Remove terminal escapes and normalize line content. */
export function normalizeUsageText(raw: string): string[] {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseReading(line: string, now: number): AgyReading | null {
  const pctMatch = PERCENT_PATTERN.exec(line)
  if (!pctMatch) return null

  const rawVal = Number(pctMatch[1].replace(',', '.'))
  if (!Number.isFinite(rawVal) || rawVal < 0 || rawVal > 100) return null

  const isExplicitlyUsed = pctMatch[2]?.toLowerCase() === 'used' || (/\bused\b/i.test(line) && !/\b(?:remaining|left)\b/i.test(line))
  const usedPct = Math.min(100, Math.max(0, isExplicitlyUsed ? rawVal : 100 - rawVal))

  let resetsAt: number | undefined
  const isoMatch = ISO_TIMESTAMP.exec(line)
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[1])
    if (!Number.isNaN(parsed) && parsed > 0) resetsAt = parsed
  } else {
    const afterPct = line.slice(pctMatch.index + pctMatch[0].length).trim()
    if (afterPct.length > 0) resetsAt = parseResetText(afterPct, now)
  }

  const textBefore = line.slice(0, pctMatch.index).trim()
  let kind: WindowKind | null = null
  let matchIndex = -1

  const sessionMatch = SESSION_PATTERN.exec(textBefore)
  const weeklyMatch = WEEKLY_PATTERN.exec(textBefore)
  const monthlyMatch = MONTHLY_PATTERN.exec(textBefore)

  if (sessionMatch) {
    kind = 'session'
    matchIndex = sessionMatch.index
  } else if (weeklyMatch) {
    kind = 'weekly'
    matchIndex = weeklyMatch.index
  } else if (monthlyMatch) {
    kind = 'monthly'
    matchIndex = monthlyMatch.index
  } else {
    return null
  }

  const rawModel = textBefore.slice(0, matchIndex).replace(/[\t\s\-–—:]+$/, '').trim()
  const model = rawModel.length > 0 ? rawModel : 'Default'

  return { kind, model, usedPct, resetsAt }
}

/**
 * Parse `agy -p /usage` output.
 *
 * Each line typically has:
 * `<Model Group>  <Window Label>  <Percentage>%  <Reset Timestamp>`
 * For example:
 * `Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z`
 * `Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z`
 */
export function parseAgyUsage(raw: string, now: number = Date.now()): AgyUsageParse {
  if (NOT_SIGNED_IN.test(raw)) {
    return { ok: false, error: 'not_signed_in', message: 'Antigravity CLI is not signed in.' }
  }

  const lines = normalizeUsageText(raw)
  const readings = lines
    .map((line) => parseReading(line, now))
    .filter((r): r is AgyReading => r !== null)

  if (readings.length === 0) {
    return { ok: false, error: 'parse_failed', message: 'The /usage output named no quota windows.' }
  }

  const windows: QuotaWindow[] = []
  const kinds: WindowKind[] = ['session', 'weekly', 'monthly']

  for (const kind of kinds) {
    const matching = readings.filter((r) => r.kind === kind)
    if (matching.length === 0) continue

    const worst = matching.reduce((top, r) => (r.usedPct > top.usedPct ? r : top))
    const breakdown = matching.length > 1
      ? matching.map(({ model, usedPct }) => ({ label: model, usedPct }))
      : undefined

    windows.push({
      kind,
      label: kind === 'session' ? 'Session (5h)' : kind === 'weekly' ? 'Weekly' : 'Monthly',
      usedPct: worst.usedPct,
      ...(worst.resetsAt !== undefined ? { resetsAt: worst.resetsAt } : {}),
      ...(breakdown ? { breakdown } : {}),
    })
  }

  if (windows.length === 0) {
    return { ok: false, error: 'parse_failed', message: 'The /usage output named no valid quota windows.' }
  }

  return { ok: true, windows }
}
