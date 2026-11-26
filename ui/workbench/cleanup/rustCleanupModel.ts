import { invoke } from '@tauri-apps/api/core'

/** A Cargo project with a build folder, as `rust_cleanup_scan` reports it. */
export interface RustTarget {
  project: string
  name: string
  target: string
  files: number
  bytes: number
  /** Bytes of the incremental-compilation caches inside the build folder. */
  incrementalBytes: number
  /** Seconds since the epoch of the last build. */
  lastBuild: number
}

/** `incremental`: the caches only, the next build is a little slower. `all`: like `cargo clean`. */
export type RustCleanMode = 'incremental' | 'all'

export interface RustCleanResult {
  target: string
  freedBytes: number
  error: string | null
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export function parseRustTarget(raw: unknown): RustTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isText(r.project) || !isText(r.target) || typeof r.name !== 'string') return null
  if (![r.files, r.bytes, r.incrementalBytes, r.lastBuild].every(isCount)) return null
  return {
    project: r.project,
    name: r.name || r.project,
    target: r.target,
    files: r.files as number,
    bytes: r.bytes as number,
    incrementalBytes: r.incrementalBytes as number,
    lastBuild: r.lastBuild as number,
  }
}

export function parseCleanResults(raw: unknown): RustCleanResult[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): RustCleanResult[] => {
    const r = item as Record<string, unknown> | null
    if (!r || !isText(r.target) || !isCount(r.freedBytes)) return []
    return [{ target: r.target, freedBytes: r.freedBytes, error: typeof r.error === 'string' ? r.error : null }]
  })
}

/** Whole days since the last build of `target`; 0 for a build in the future. */
export const idleDays = (target: RustTarget, now: number) => Math.max(0, Math.floor((now - target.lastBuild * 1000) / 86_400_000))

/** The targets not built for at least `days` days (all of them for 0). */
export function idleTargets(targets: readonly RustTarget[], days: number, now: number): RustTarget[] {
  return days > 0 ? targets.filter((target) => idleDays(target, now) >= days) : [...targets]
}

/** What `mode` frees from the `selected` build folders. */
export function freeable(targets: readonly RustTarget[], selected: ReadonlySet<string>, mode: RustCleanMode): number {
  return targets.reduce((sum, target) => (selected.has(target.target) ? sum + (mode === 'all' ? target.bytes : target.incrementalBytes) : sum), 0)
}

/**
 * The list after a clean-up, from what each build folder lost: a fully cleaned folder is dropped,
 * a cache clean-up leaves the folder with no cache.
 */
export function applyCleanResults(targets: readonly RustTarget[], results: readonly RustCleanResult[], mode: RustCleanMode): RustTarget[] {
  const byTarget = new Map(results.map((result) => [result.target, result]))
  return targets.flatMap((target) => {
    const result = byTarget.get(target.target)
    if (!result) return [target]
    if (mode === 'all' && !result.error) return []
    const bytes = Math.max(0, target.bytes - result.freedBytes)
    const incrementalBytes = mode === 'incremental' && !result.error ? 0 : Math.max(0, target.incrementalBytes - result.freedBytes)
    return [{ ...target, bytes, incrementalBytes: Math.min(incrementalBytes, bytes) }]
  })
}

export async function scanRustTargets(extraRoots: readonly string[]): Promise<RustTarget[]> {
  const raw = await invoke<unknown>('rust_cleanup_scan', { extraRoots })
  return Array.isArray(raw) ? raw.flatMap((item) => parseRustTarget(item) ?? []) : []
}

export async function cleanRustTargets(targets: readonly string[], mode: RustCleanMode): Promise<RustCleanResult[]> {
  return parseCleanResults(await invoke<unknown>('rust_cleanup_run', { targets, mode }))
}

/** Stops the running scan or clean-up at its next file. */
export async function cancelRustJob(): Promise<void> {
  try {
    await invoke<void>('rust_cleanup_cancel')
  } catch {
    // Nothing running any more: the job has ended on its own.
  }
}

/** The backend's progress event of a Rust scan or clean-up. */
export const RUST_PROGRESS_EVENT = 'rust-cleanup:progress'
