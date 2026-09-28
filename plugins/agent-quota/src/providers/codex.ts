import path from 'node:path'

import type { ProviderDeps } from '../deps'
import type { QuotaCredits, QuotaSnapshot, QuotaWindow } from '../types'

import { asNumber, asRecord, normalizeRateWindow, toEpochMs, worstPerKind } from '../windows'

const TAIL_BYTES = 512 * 1024

interface RolloutReading {
  windows: QuotaWindow[]
  credits?: QuotaCredits
  at: number
}

function parseCredits(value: unknown): QuotaCredits | undefined {
  const credits = asRecord(value)
  if (!credits || credits.has_credits !== true) return undefined
  return { balance: asNumber(credits.balance), unlimited: credits.unlimited === true }
}

/** `rate_limits` as Codex writes it: `primary` (5 h) and `secondary` (7 d) plus `credits`. */
export function parseRateLimits(value: unknown): { windows: QuotaWindow[]; credits?: QuotaCredits } | null {
  const limits = asRecord(value)
  if (!limits) return null
  const windows = [
    normalizeRateWindow(limits.primary ?? limits.primary_window, 'session'),
    normalizeRateWindow(limits.secondary ?? limits.secondary_window ?? limits.weekly_window, 'weekly'),
    normalizeRateWindow(limits.monthly_window ?? limits.month_window, 'monthly'),
  ].filter((window): window is QuotaWindow => window !== null)
  if (windows.length === 0) return null
  const credits = parseCredits(limits.credits)
  return { windows: worstPerKind(windows), ...(credits ? { credits } : {}) }
}

async function newestRollout(sessionsDir: string, deps: ProviderDeps): Promise<string | null> {
  const descending = async (dir: string) => (await deps.listDir(dir)).filter((name) => /^\d+$/.test(name)).sort().reverse()
  for (const year of (await descending(sessionsDir)).slice(0, 2)) {
    for (const month of (await descending(path.join(sessionsDir, year))).slice(0, 3)) {
      for (const day of (await descending(path.join(sessionsDir, year, month))).slice(0, 7)) {
        const dayDir = path.join(sessionsDir, year, month, day)
        const files = (await deps.listDir(dayDir)).filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl'))
        let newest: { file: string; mtime: number } | null = null
        for (const name of files) {
          const file = path.join(dayDir, name)
          const mtime = (await deps.mtime(file)) ?? 0
          if (!newest || mtime > newest.mtime) newest = { file, mtime }
        }
        if (newest) return newest.file
      }
    }
  }
  return null
}

/** The latest `rate_limits` Codex recorded after a model turn, read from the end of the newest rollout. */
export async function readLatestRollout(codexHome: string, deps: ProviderDeps): Promise<RolloutReading | null> {
  const file = await newestRollout(path.join(codexHome, 'sessions'), deps)
  const tail = file ? await deps.readTail(file, TAIL_BYTES) : null
  if (!tail) return null
  const lines = tail.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes('"rate_limits"')) continue
    try {
      const event = asRecord(JSON.parse(lines[index]))
      const payload = asRecord(event?.payload)
      const parsed = parseRateLimits(payload?.rate_limits)
      const at = toEpochMs(event?.timestamp)
      if (parsed && at !== undefined) return { ...parsed, at }
    } catch {
      // The first line of a tail is usually cut mid-record.
    }
  }
  return null
}

/**
 * Codex usage from the `rate_limits` event Codex itself writes into its session log after every
 * model turn — the same numbers its `/status` shows, with no token and no request. Every turn on
 * this machine writes a new event, so the newest one is what this profile has spent here (a floor:
 * other devices on the account may add more). A window whose reset has passed since then no longer
 * says anything true and is dropped.
 */
export async function fetchCodexUsage(profileDir: string | null | undefined, deps: ProviderDeps): Promise<QuotaSnapshot> {
  const now = deps.now()
  const reading = await readLatestRollout(profileDir || path.join(deps.home, '.codex'), deps)
  const windows = reading?.windows.filter((window) => window.resetsAt === undefined || window.resetsAt > now) ?? []
  if (!reading || windows.length === 0) {
    return { windows: [], fetchedAt: now, error: 'unsupported', message: 'Codex usage appears after its first reply.' }
  }
  return { windows, fetchedAt: now, source: 'rollout', ...(reading.credits ? { credits: reading.credits } : {}) }
}
