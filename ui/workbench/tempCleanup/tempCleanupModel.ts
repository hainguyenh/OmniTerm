import { invoke } from '@tauri-apps/api/core'

/** A kind of entry in the temp folder, as `temp_cleanup_scan` reports it. */
export interface TempGroup {
  key: string
  entries: number
  files: number
  bytes: number
  /** Seconds since the epoch of the least and most recently changed entry. */
  oldest: number
  newest: number
}

export interface CleanReport {
  removed: number
  freedBytes: number
  kept: number
  skipped: Array<{ name: string; reason: string }>
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseTempGroup(raw: unknown): TempGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.key !== 'string' || !r.key) return null
  if (![r.entries, r.files, r.bytes, r.oldest, r.newest].every(isCount)) return null
  return {
    key: r.key,
    entries: r.entries as number,
    files: r.files as number,
    bytes: r.bytes as number,
    oldest: r.oldest as number,
    newest: r.newest as number,
  }
}

export function parseCleanReport(raw: unknown): CleanReport {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const skipped = Array.isArray(r.skipped)
    ? r.skipped.flatMap((item): Array<{ name: string; reason: string }> => {
        const s = item as Record<string, unknown> | null
        return s && typeof s.name === 'string' && typeof s.reason === 'string' ? [{ name: s.name, reason: s.reason }] : []
      })
    : []
  return {
    removed: isCount(r.removed) ? r.removed : 0,
    freedBytes: isCount(r.freedBytes) ? r.freedBytes : 0,
    kept: isCount(r.kept) ? r.kept : 0,
    skipped,
  }
}

export async function scanTemp(): Promise<TempGroup[]> {
  const raw = await invoke<unknown>('temp_cleanup_scan')
  return Array.isArray(raw) ? raw.flatMap((item) => parseTempGroup(item) ?? []) : []
}

export async function cleanTemp(keys: readonly string[], olderThanDays: number): Promise<CleanReport> {
  const raw = await invoke<unknown>('temp_cleanup_run', { keys, olderThanHours: Math.round(olderThanDays * 24) })
  return parseCleanReport(raw)
}

/** The total size of the groups named in `selected`. */
export const selectedBytes = (groups: readonly TempGroup[], selected: ReadonlySet<string>) =>
  groups.reduce((total, group) => total + (selected.has(group.key) ? group.bytes : 0), 0)

/** How long ago `seconds` (since the epoch) was, in whole days; 0 for a time in the future. */
export const daysSince = (seconds: number, now: number) => Math.max(0, Math.floor((now - seconds * 1000) / 86_400_000))
