import type { QuotaError, QuotaWindow, WindowKind } from './types'

import { parseResetText } from './parseReset'

/**
 * Parse `claude -p /usage` output.
 *
 * The CLI's wording has drifted between releases and the same run mixes quota lines with prose
 * that also contains percentages ("59% of your usage was at >150k context"). So a value is only
 * taken from a line that *starts* with a known window label, and everything else is ignored.
 * When the label and the number sit on neighbouring lines (the bar layout of the interactive
 * panel), the next two lines are searched too, stopping at the next label.
 *
 * A reply that names no quota window at all — for example a model answer, when an argument got
 * mangled into a prompt — is `parse_failed`, never zero usage.
 */

export type ClaudeUsageParse =
  | { ok: true; windows: QuotaWindow[] }
  | { ok: false; error: QuotaError; message: string }

interface Label {
  kind: WindowKind
  pattern: RegExp
}

const LABELS: Label[] = [
  { kind: 'session', pattern: /^(?:current\s+session|5[-\s]?h(?:ou)?r?s?(?:\s+(?:limit|window|session))?|session)\b(?:\s*\([^)]*\))?/i },
  { kind: 'weekly', pattern: /^(?:current\s+week|weekly(?:\s+limit)?|week|7[-\s]?days?(?:\s+limit)?)\b(?:\s*\([^)]*\))?/i },
  { kind: 'monthly', pattern: /^(?:current\s+month|monthly(?:\s+limit)?)\b(?:\s*\([^)]*\))?/i },
]

const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(used|left|remaining)?/i
const RESET = /\bresets?\b\s*(.+)$/i
const NOT_SIGNED_IN = /(?:please\s+run\s+\/login|not\s+logged\s+in|invalid\s+api\s+key|oauth\s+token\s+has\s+expired)/i

/** Remove terminal escapes, bar glyphs and odd separators so labels start their lines. */
export function normalizeUsageText(raw: string): string[] {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '')
    .replace(/[─-▟■-◿⠀-⣿]/g, ' ')
    .replace(/[·•|]/g, ' · ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').replace(/^[\s>*\-–—:·]+/, '').trim())
}

function matchLabel(line: string): { kind: WindowKind; label: string; rest: string } | null {
  for (const { kind, pattern } of LABELS) {
    const match = pattern.exec(line)
    if (!match) continue
    const rest = line.slice(match[0].length)
    // "Session history" or "Weekly digest" prose has no colon and no percentage. A label alone on
    // its line is the bar layout; its value must then come from the lines below.
    if (rest.trim() !== '' && !/^\s*:/.test(rest) && !PERCENT.test(rest)) continue
    return { kind, label: match[0].replace(/\s+/g, ' ').trim(), rest }
  }
  return null
}

function readPercent(text: string, needsDirection: boolean): number | null {
  const match = PERCENT.exec(text)
  if (!match || (needsDirection && !match[2])) return null
  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  const direction = match[2]?.toLowerCase()
  return direction === 'left' || direction === 'remaining' ? 100 - value : value
}

interface Reading {
  kind: WindowKind
  label: string
  usedPct: number
  resetsAt?: number
}

function readWindow(lines: string[], index: number, now: number): Reading | null {
  const head = matchLabel(lines[index])
  if (!head) return null
  const scope = [head.rest]
  for (let next = index + 1; next <= index + 2 && next < lines.length; next += 1) {
    if (!lines[next] || matchLabel(lines[next])) break
    scope.push(lines[next])
  }
  let usedPct: number | null = null
  let resetsAt: number | undefined
  // A value below the label must say "used", "left" or "remaining": a bare percentage there is
  // more likely prose ("59% of your usage was at >150k context") than the window's reading.
  for (const [position, text] of scope.entries()) {
    usedPct ??= readPercent(text, position > 0)
    const reset = RESET.exec(text)
    if (reset && resetsAt === undefined) resetsAt = parseResetText(reset[1], now)
  }
  if (usedPct === null) return null
  return { kind: head.kind, label: head.label.replace(/[:\s]+$/, ''), usedPct, resetsAt }
}

const MAX_RESET_AHEAD_MS = 8 * 86_400_000

/** Parse the CLI output. `now` is injectable so reset dates are deterministic in tests. */
export function parseClaudeUsage(raw: string, now: number = Date.now()): ClaudeUsageParse {
  if (NOT_SIGNED_IN.test(raw)) {
    return { ok: false, error: 'not_signed_in', message: 'Claude Code is not signed in for this profile.' }
  }
  const lines = normalizeUsageText(raw)
  const readings = lines
    .map((_, index) => readWindow(lines, index, now))
    .filter((reading): reading is Reading => reading !== null)
    .map((reading) => (
      reading.resetsAt !== undefined && reading.resetsAt > now + MAX_RESET_AHEAD_MS
        ? { ...reading, resetsAt: undefined }
        : reading
    ))
  const byKind = (kind: WindowKind) => readings.filter((reading) => reading.kind === kind)
  const session = byKind('session')[0]
  if (!session) {
    return { ok: false, error: 'parse_failed', message: 'The /usage output named no session window.' }
  }
  const windows: QuotaWindow[] = [session]
  // Weekly may be split per model ("all models", "Opus", "Sonnet"): the highest one is what runs
  // out first, so it drives the limit, and the rest ride along for the tooltip.
  const weekly = byKind('weekly')
  if (weekly.length > 0) {
    const worst = weekly.reduce((top, reading) => (reading.usedPct > top.usedPct ? reading : top))
    windows.push({
      ...worst,
      breakdown: weekly.length > 1 ? weekly.map(({ label, usedPct }) => ({ label, usedPct })) : undefined,
    })
  }
  const monthly = byKind('monthly')[0]
  if (monthly) windows.push(monthly)
  return {
    ok: true,
    windows: windows.map(({ breakdown, resetsAt, ...rest }: QuotaWindow) => ({
      ...rest,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      ...(breakdown ? { breakdown } : {}),
    })),
  }
}
