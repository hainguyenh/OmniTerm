import type { QuotaWindow, WindowKind } from './types'

/** JSON helpers for provider payloads, which are external data and validated field by field. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key])
    if (value !== null) return value
  }
  return null
}

const HOUR = 3600
const DAY = 24 * HOUR

/** Name a window by its length: 4–6 h is the session, 6–8 d the week, 27–32 d the month. */
export function classifyWindowSeconds(seconds: number | null): WindowKind | null {
  if (seconds === null || seconds <= 0) return null
  if (seconds >= 4 * HOUR && seconds <= 6 * HOUR) return 'session'
  if (seconds >= 6 * DAY && seconds <= 8 * DAY) return 'weekly'
  if (seconds >= 27 * DAY && seconds <= 32 * DAY) return 'monthly'
  return null
}

/** Epoch seconds or milliseconds, or an ISO string, as epoch milliseconds. */
export function toEpochMs(value: unknown): number | undefined {
  const numeric = asNumber(value)
  if (numeric !== null) return numeric > 1e12 ? numeric : numeric * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

export function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value))
}

const LABELS: Record<WindowKind, string> = {
  session: '5-hour session',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/**
 * Normalise a Codex-style window (`used_percent`, `reset_at`/`resets_at`, `limit_window_seconds`
 * or `window_minutes`). `fallback` names the window when its length is missing: the first window a
 * provider reports is the session, the second the week.
 */
export function normalizeRateWindow(value: unknown, fallback: WindowKind | null): QuotaWindow | null {
  const source = asRecord(value)
  if (!source) return null
  const usedPct = firstNumber(source, ['used_percent', 'usedPercent', 'usage_percent'])
  if (usedPct === null) return null
  const seconds = firstNumber(source, ['limit_window_seconds', 'window_seconds', 'windowSeconds'])
    ?? (() => {
      const minutes = firstNumber(source, ['window_minutes', 'windowMinutes'])
      return minutes === null ? null : minutes * 60
    })()
  const kind = classifyWindowSeconds(seconds) ?? fallback
  if (!kind) return null
  const resetsAt = toEpochMs(source.reset_at ?? source.resets_at ?? source.resetAt ?? source.resetsAt)
  return {
    kind,
    usedPct: clampPct(usedPct),
    label: LABELS[kind],
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  }
}

/** Keep one window per kind — the fullest, since that one runs out first. */
export function worstPerKind(windows: QuotaWindow[]): QuotaWindow[] {
  const order: WindowKind[] = ['session', 'weekly', 'monthly']
  return order
    .map((kind) => windows
      .filter((window) => window.kind === kind)
      .reduce<QuotaWindow | null>((top, window) => (!top || window.usedPct > top.usedPct ? window : top), null))
    .filter((window): window is QuotaWindow => window !== null)
}
