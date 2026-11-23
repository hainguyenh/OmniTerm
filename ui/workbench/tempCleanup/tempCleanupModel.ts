import { invoke } from '@tauri-apps/api/core'

/** The entries of a group unchanged for at least `days` days: what that idle time deletes. */
export interface IdleShare {
  days: number
  entries: number
  bytes: number
}

/** A kind of entry in the temp folder, as `temp_cleanup_scan` reports it. */
export interface TempGroup {
  key: string
  entries: number
  files: number
  bytes: number
  /** Seconds since the epoch of the least and most recently changed entry. */
  oldest: number
  newest: number
  /** One share per idle time the dialog offers (1, 3, 7 and 30 days). */
  idle: IdleShare[]
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
  const idle = Array.isArray(r.idle)
    ? r.idle.flatMap((item): IdleShare[] => {
        const s = item as Record<string, unknown> | null
        return s && isCount(s.days) && isCount(s.entries) && isCount(s.bytes)
          ? [{ days: s.days, entries: s.entries, bytes: s.bytes }]
          : []
      })
    : []
  return {
    key: r.key,
    entries: r.entries as number,
    files: r.files as number,
    bytes: r.bytes as number,
    oldest: r.oldest as number,
    newest: r.newest as number,
    idle,
  }
}

/**
 * What deleting `group` with an idle time of `days` removes. "Any time" (0) is the whole group;
 * a scan without the shares (an older backend) cannot tell, and counts the whole group as well.
 */
export function deletable(group: TempGroup, days: number): { entries: number; bytes: number } {
  const share = days > 0 ? group.idle.find((s) => s.days === days) : undefined
  return share ? { entries: share.entries, bytes: share.bytes } : { entries: group.entries, bytes: group.bytes }
}

/** What deleting the groups named in `selected` with an idle time of `days` removes. */
export function deletableTotal(
  groups: readonly TempGroup[],
  selected: ReadonlySet<string>,
  days: number,
): { entries: number; bytes: number } {
  return groups.reduce(
    (total, group) => {
      if (!selected.has(group.key)) return total
      const part = deletable(group, days)
      return { entries: total.entries + part.entries, bytes: total.bytes + part.bytes }
    },
    { entries: 0, bytes: 0 },
  )
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
    // The removed entries were the idlest: each share loses them, down to nothing. Exact for the
    // shorter idle times; a rescan corrects a longer one that kept a refused entry.
    const idle = group.idle.map((share) => ({
      ...share,
      entries: Math.max(0, share.entries - result.removed),
      bytes: Math.max(0, share.bytes - result.freedBytes),
    }))
    return [{ ...group, entries, bytes: Math.max(0, group.bytes - result.freedBytes), idle }]
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

/** How long ago `seconds` (since the epoch) was, in whole days; 0 for a time in the future. */
export const daysSince = (seconds: number, now: number) => Math.max(0, Math.floor((now - seconds * 1000) / 86_400_000))
