import { invoke } from '@tauri-apps/api/core'

/** A linked worktree, as `worktree_cleanup_scan` reports it. */
export interface WorktreeEntry {
  path: string
  repo: string
  repoName: string
  branch: string | null
  head: string | null
  locked: boolean
  /** Git lists it but its folder is gone. */
  missing: boolean
  /** Uncommitted changes, untracked files included; null when unknown. */
  changes: number | null
  lastActiveMs: number
  upstream: string | null
  /** Its branch tracks a remote branch that was deleted. */
  upstreamGone: boolean
  ahead: number
  behind: number
  base: string | null
  /** Every commit of it is on `base`. */
  merged: boolean
  bytes: number | null
}

export interface RemoveFailure {
  path: string
  reason: string
}

export interface WorktreeRemoveReport {
  removed: string[]
  deletedBranches: string[]
  keptBranches: RemoveFailure[]
  failed: RemoveFailure[]
}

/** `remove`: nothing would be lost. `review`: nothing unsaved, but maybe still wanted. `keep`: work would be lost. */
export type Verdict = 'remove' | 'review' | 'keep'

export interface Suggestion {
  verdict: Verdict
  /** Why, most decisive first. */
  reasons: string[]
}

/** Idle time from which a worktree with nothing unsaved is worth a look. */
export const IDLE_REVIEW_DAYS = 30

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const textOrNull = (value: unknown): string | null => (isText(value) ? value : null)
const countOrNull = (value: unknown): number | null => (isCount(value) ? value : null)

export function parseWorktreeEntry(raw: unknown): WorktreeEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isText(r.path) || !isText(r.repo)) return null
  return {
    path: r.path,
    repo: r.repo,
    repoName: isText(r.repoName) ? r.repoName : r.repo,
    branch: textOrNull(r.branch),
    head: textOrNull(r.head),
    locked: r.locked === true,
    missing: r.missing === true,
    changes: countOrNull(r.changes),
    lastActiveMs: countOrNull(r.lastActiveMs) ?? 0,
    upstream: textOrNull(r.upstream),
    upstreamGone: r.upstreamGone === true,
    ahead: countOrNull(r.ahead) ?? 0,
    behind: countOrNull(r.behind) ?? 0,
    base: textOrNull(r.base),
    merged: r.merged === true,
    bytes: countOrNull(r.bytes),
  }
}

function parseFailures(raw: unknown): RemoveFailure[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): RemoveFailure[] => {
    const r = item as Record<string, unknown> | null
    return r && isText(r.path) && typeof r.reason === 'string' ? [{ path: r.path, reason: r.reason }] : []
  })
}

const texts = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter(isText) : [])

export function parseRemoveReport(raw: unknown): WorktreeRemoveReport {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    removed: texts(r.removed),
    deletedBranches: texts(r.deletedBranches),
    keptBranches: parseFailures(r.keptBranches),
    failed: parseFailures(r.failed),
  }
}

/** Whole days since the worktree was last used; null when unknown. */
export function idleDaysOf(entry: WorktreeEntry, now: number): number | null {
  return entry.lastActiveMs > 0 ? Math.max(0, Math.floor((now - entry.lastActiveMs) / 86_400_000)) : null
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/**
 * What to do with a worktree, from what removing it would lose. Uncommitted changes and commits
 * that exist nowhere else always mean keep; a merged branch or a branch whose remote was deleted
 * after a merge means remove; anything else idle for a while is offered for review.
 */
export function suggest(entry: WorktreeEntry, now: number, idleReviewDays = IDLE_REVIEW_DAYS): Suggestion {
  if (entry.missing) return { verdict: 'remove', reasons: ['Folder is gone'] }
  const idle = idleDaysOf(entry, now)
  const idleReason = idle !== null && idle >= idleReviewDays ? [`Idle ${idle} days`] : []
  const keep: string[] = []
  if (entry.locked) keep.push('Locked')
  if (entry.changes) keep.push(plural(entry.changes, 'uncommitted change'))
  if (entry.ahead) keep.push(`${plural(entry.ahead, 'commit')} not pushed`)
  if (keep.length) return { verdict: 'keep', reasons: [...keep, ...idleReason] }
  if (entry.merged && entry.base) return { verdict: 'remove', reasons: [`Merged into ${entry.base}`, ...idleReason] }
  // Usually deleted after its pull request merged; a squash merge leaves its commits off the main
  // line, so this is offered for review rather than removal.
  if (entry.upstreamGone) {
    return { verdict: 'review', reasons: ['Remote branch deleted', `Not merged into ${entry.base ?? 'the main branch'}`, ...idleReason] }
  }
  if (!entry.upstream && entry.branch) return { verdict: 'keep', reasons: ['Commits only in this worktree', ...idleReason] }
  if (idleReason.length) return { verdict: 'review', reasons: [...idleReason, entry.upstream ? 'Everything pushed' : 'Detached HEAD'] }
  return { verdict: 'keep', reasons: [idle === null ? 'In use' : idle === 0 ? 'Used today' : `Used ${idle}d ago`] }
}

/** Verdicts most worth acting on first. */
const ORDER: Record<Verdict, number> = { remove: 0, review: 1, keep: 2 }

/** Worktrees by repository, then suggested removals first, then the biggest. */
export function sortWorktrees(entries: readonly WorktreeEntry[], now: number): WorktreeEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.repoName.localeCompare(b.repoName) ||
      ORDER[suggest(a, now).verdict] - ORDER[suggest(b, now).verdict] ||
      (b.bytes ?? 0) - (a.bytes ?? 0) ||
      a.path.localeCompare(b.path),
  )
}

export async function scanWorktrees(extraRoots: readonly string[]): Promise<WorktreeEntry[]> {
  const raw = await invoke<unknown>('worktree_cleanup_scan', { extraRoots })
  return Array.isArray(raw) ? raw.flatMap((item) => parseWorktreeEntry(item) ?? []) : []
}

export async function removeWorktrees(paths: readonly string[], force: boolean, deleteMergedBranches: boolean): Promise<WorktreeRemoveReport> {
  return parseRemoveReport(await invoke<unknown>('worktree_cleanup_remove', { paths, force, deleteMergedBranches }))
}

/** Stops the running scan at its next worktree. */
export async function cancelWorktreeScan(): Promise<void> {
  try {
    await invoke<void>('worktree_cleanup_cancel')
  } catch {
    // Nothing running any more.
  }
}

/** The backend's progress event of a worktree scan. */
export const WORKTREE_PROGRESS_EVENT = 'worktree-cleanup:progress'
