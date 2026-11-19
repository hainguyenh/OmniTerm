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

/** What a clean-up did to one group. */
export interface GroupResult {
  key: string
  removed: number
  freedBytes: number
}

export interface CleanReport {
  removed: number
  freedBytes: number
  kept: number
  skipped: Array<{ name: string; reason: string }>
  groups: GroupResult[]
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
  const groups = Array.isArray(r.groups)
    ? r.groups.flatMap((item): GroupResult[] => {
        const g = item as Record<string, unknown> | null
        return g && typeof g.key === 'string' && isCount(g.removed) && isCount(g.freedBytes)
          ? [{ key: g.key, removed: g.removed, freedBytes: g.freedBytes }]
          : []
      })
    : []
  return {
    removed: isCount(r.removed) ? r.removed : 0,
    freedBytes: isCount(r.freedBytes) ? r.freedBytes : 0,
    kept: isCount(r.kept) ? r.kept : 0,
    skipped,
    groups,
  }
}

/**
 * The scan's groups after a clean-up, from what the report says each group lost: the list stays
 * right without scanning the whole temp folder again. A group left without entries is dropped.
 */
export function applyCleanReport(groups: readonly TempGroup[], report: CleanReport): TempGroup[] {
  const results = new Map(report.groups.map((result) => [result.key, result]))
  return groups.flatMap((group) => {
    const result = results.get(group.key)
    if (!result) return [group]
    const entries = Math.max(0, group.entries - result.removed)
    if (!entries) return []
    return [{ ...group, entries, bytes: Math.max(0, group.bytes - result.freedBytes) }]
  }).sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))
}

export async function scanTemp(): Promise<TempGroup[]> {
  const raw = await invoke<unknown>('temp_cleanup_scan')
  return Array.isArray(raw) ? raw.flatMap((item) => parseTempGroup(item) ?? []) : []
}

export async function cleanTemp(keys: readonly string[], olderThanDays: number): Promise<CleanReport> {
  const raw = await invoke<unknown>('temp_cleanup_run', { keys, olderThanHours: Math.round(olderThanDays * 24) })
  return parseCleanReport(raw)
}

/** Stops the running scan or clean-up at its next file. */
export async function cancelTempJob(): Promise<void> {
  try {
    await invoke<void>('temp_cleanup_cancel')
  } catch {
    // Nothing running any more: the job has ended on its own.
  }
}

/** The backend's progress event of a temp scan or clean-up. */
export const TEMP_PROGRESS_EVENT = 'temp-cleanup:progress'

/** The total size of the groups named in `selected`. */
export const selectedBytes = (groups: readonly TempGroup[], selected: ReadonlySet<string>) =>
  groups.reduce((total, group) => total + (selected.has(group.key) ? group.bytes : 0), 0)

/** How long ago `seconds` (since the epoch) was, in whole days; 0 for a time in the future. */
export const daysSince = (seconds: number, now: number) => Math.max(0, Math.floor((now - seconds * 1000) / 86_400_000))
