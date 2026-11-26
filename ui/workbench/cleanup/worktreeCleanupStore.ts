import { create } from 'zustand'

import { notifications } from '../../ide/workbench/contributions'
import { followProgress, showJobTask, type JobProgress, type JobTask } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { useCleanupRoots } from './cleanupRootsStore'
import { isCleanUpTabShown, useCleanUpView } from './cleanUpViewStore'
import {
  cancelWorktreeScan,
  removeWorktrees,
  scanWorktrees,
  WORKTREE_PROGRESS_EVENT,
  type WorktreeEntry,
  type WorktreeRemoveReport,
} from './worktreeCleanupModel'

export interface WorktreeJob {
  kind: 'scan' | 'remove'
  progress: JobProgress | null
  cancelling: boolean
}

interface WorktreeCleanupState {
  /** The last scan's worktrees; null before the first scan. */
  entries: WorktreeEntry[] | null
  scannedAt: number
  job: WorktreeJob | null
  status: string | null
  error: string | null
}

export const useWorktreeCleanup = create<WorktreeCleanupState>(() => ({
  entries: null,
  scannedAt: 0,
  job: null,
  status: null,
  error: null,
}))

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

const SCAN_TASK: JobTask = {
  id: 'omniterm.worktreeCleanup',
  title: 'Scanning worktrees',
  unit: 'worktrees',
  bytesLabel: 'found',
  cancel: () => cancelWorktreeScanNow(),
}

/** Asks the running scan to stop at its next worktree (a removal runs to the end). */
export function cancelWorktreeScanNow(): void {
  const { job } = useWorktreeCleanup.getState()
  if (job?.kind !== 'scan' || job.cancelling) return
  useWorktreeCleanup.setState({ job: { ...job, cancelling: true } })
  void cancelWorktreeScan()
}

/** Lists the linked worktrees of every repository under the workspaces and the added folders. */
export async function startWorktreeScan(): Promise<void> {
  if (useWorktreeCleanup.getState().job) return
  useWorktreeCleanup.setState({ job: { kind: 'scan', progress: null, cancelling: false }, error: null })
  showJobTask(SCAN_TASK, null)
  const stop = followProgress(WORKTREE_PROGRESS_EVENT, (progress) => {
    const { job } = useWorktreeCleanup.getState()
    if (job?.kind !== 'scan') return
    useWorktreeCleanup.setState({ job: { ...job, progress } })
    if (!job.cancelling) showJobTask(SCAN_TASK, progress)
  })
  try {
    const entries = await scanWorktrees(useCleanupRoots.getState().roots)
    const total = entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
    useWorktreeCleanup.setState({
      entries,
      scannedAt: Date.now(),
      status: `${plural(entries.length, 'worktree')}, ${formatBytes(total)} in all.`,
    })
  } catch (cause) {
    useWorktreeCleanup.setState({ error: `Scan failed: ${String(cause)}` })
  } finally {
    stop()
    showJobTask(SCAN_TASK, 'done')
    useWorktreeCleanup.setState({ job: null })
  }
}

/** What a finished removal says in the panel and, when the panel is hidden, in a notification. */
export function removeSummary(report: WorktreeRemoveReport): string {
  const parts = [`Removed ${plural(report.removed.length, 'worktree')}`]
  const branches = report.deletedBranches.length
  if (branches) parts.push(`deleted ${branches} ${branches === 1 ? 'branch' : 'branches'}`)
  let text = `${parts.join(', ')}.`
  if (report.failed.length) text += ` ${plural(report.failed.length, 'worktree')} kept: ${report.failed[0]?.reason}`
  if (report.keptBranches.length) text += ` Branch ${report.keptBranches[0]?.path} kept: ${report.keptBranches[0]?.reason}`
  return text
}

/** Removes the worktrees at `paths`; `force` discards their uncommitted changes. */
export async function startWorktreeRemove(paths: readonly string[], force: boolean, deleteMergedBranches: boolean): Promise<void> {
  if (useWorktreeCleanup.getState().job) return
  useWorktreeCleanup.setState({ job: { kind: 'remove', progress: null, cancelling: false }, error: null })
  try {
    const report = await removeWorktrees(paths, force, deleteMergedBranches)
    const removed = new Set(report.removed)
    const status = removeSummary(report)
    const { entries } = useWorktreeCleanup.getState()
    useWorktreeCleanup.setState({ status, entries: entries && entries.filter((entry) => !removed.has(entry.path)) })
    if (!isCleanUpTabShown('worktrees')) {
      notifications().notify({
        group: 'tools',
        level: report.failed.length ? 'warning' : 'info',
        title: 'Worktrees removed',
        body: status,
        actions: [{ label: 'Show', run: () => useCleanUpView.getState().show('worktrees') }],
      })
    }
  } catch (cause) {
    useWorktreeCleanup.setState({ error: `Removal failed: ${String(cause)}` })
  } finally {
    useWorktreeCleanup.setState({ job: null })
  }
}
