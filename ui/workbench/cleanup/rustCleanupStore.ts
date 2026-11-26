import { create } from 'zustand'

import { notifications } from '../../ide/workbench/contributions'
import { followProgress, showJobTask, type JobProgress, type JobTask } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { useCleanupRoots } from './cleanupRootsStore'
import { isCleanUpTabShown, useCleanUpView } from './cleanUpViewStore'
import {
  applyCleanResults,
  cancelRustJob,
  cleanRustTargets,
  RUST_PROGRESS_EVENT,
  scanRustTargets,
  type RustCleanMode,
  type RustCleanResult,
  type RustTarget,
} from './rustCleanupModel'

/** The scan or clean-up running, with how far it has got. */
export interface RustJob {
  kind: 'scan' | 'clean'
  progress: JobProgress | null
  cancelling: boolean
}

interface RustCleanupState {
  /** The last scan's build folders; null before the first scan. */
  targets: RustTarget[] | null
  scannedAt: number
  /** Lives here, not in the panel: closing the tool window leaves it running in the status bar. */
  job: RustJob | null
  status: string | null
  error: string | null
}

export const useRustCleanup = create<RustCleanupState>(() => ({
  targets: null,
  scannedAt: 0,
  job: null,
  status: null,
  error: null,
}))

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

const taskFor = (kind: RustJob['kind']): JobTask => ({
  id: 'omniterm.rustCleanup',
  title: kind === 'scan' ? 'Scanning Rust build folders' : 'Cleaning Rust build folders',
  unit: kind === 'scan' ? 'projects' : 'build folders',
  bytesLabel: kind === 'scan' ? 'found' : 'freed',
  cancel: () => cancelRustJobNow(),
})

/** Asks the running job to stop at its next file. */
export function cancelRustJobNow(): void {
  const { job } = useRustCleanup.getState()
  if (!job || job.cancelling) return
  useRustCleanup.setState({ job: { ...job, cancelling: true } })
  void cancelRustJob()
}

async function runJob<T>(kind: RustJob['kind'], work: () => Promise<T>): Promise<T | undefined> {
  if (useRustCleanup.getState().job) return undefined
  const task = taskFor(kind)
  useRustCleanup.setState({ job: { kind, progress: null, cancelling: false }, error: null })
  showJobTask(task, null)
  const stop = followProgress(RUST_PROGRESS_EVENT, (progress) => {
    const { job } = useRustCleanup.getState()
    if (job?.kind !== kind) return
    useRustCleanup.setState({ job: { ...job, progress } })
    if (!job.cancelling) showJobTask(task, progress)
  })
  try {
    return await work()
  } finally {
    stop()
    showJobTask(task, 'done')
    useRustCleanup.setState({ job: null })
  }
}

/** Searches the workspaces and the added folders for Cargo build folders. */
export async function startRustScan(): Promise<void> {
  try {
    await runJob('scan', async () => {
      const targets = await scanRustTargets(useCleanupRoots.getState().roots)
      const total = targets.reduce((sum, target) => sum + target.bytes, 0)
      useRustCleanup.setState({
        targets,
        scannedAt: Date.now(),
        status: `${plural(targets.length, 'build folder')}, ${formatBytes(total)} in all.`,
      })
    })
  } catch (cause) {
    useRustCleanup.setState({ error: `Scan failed: ${String(cause)}` })
  }
}

/** What a finished clean-up says in the panel and, when the panel is hidden, in a notification. */
export function rustCleanSummary(results: readonly RustCleanResult[], mode: RustCleanMode): string {
  const freed = results.reduce((sum, result) => sum + result.freedBytes, 0)
  const failed = results.filter((result) => result.error)
  const what = mode === 'all' ? 'build folder' : 'cache'
  const kept = failed.length ? ` ${plural(failed.length, 'folder')} partly kept (in use?): ${failed[0]?.error}` : ''
  return `Cleaned ${plural(results.length - failed.length, what)}, freed ${formatBytes(freed)}.${kept}`
}

/** Cleans `mode`'s part of the chosen build folders, then updates the list from the results. */
export async function startRustClean(targets: readonly string[], mode: RustCleanMode): Promise<void> {
  try {
    const results = await runJob('clean', () => cleanRustTargets(targets, mode))
    if (!results) return
    const status = rustCleanSummary(results, mode)
    const current = useRustCleanup.getState().targets
    useRustCleanup.setState({ status, targets: current && applyCleanResults(current, results, mode) })
    if (!isCleanUpTabShown('rust')) {
      notifications().notify({
        group: 'tools',
        level: results.some((result) => result.error) ? 'warning' : 'info',
        title: 'Rust build folders cleaned',
        body: status,
        actions: [{ label: 'Show', run: () => useCleanUpView.getState().show('rust') }],
      })
    }
  } catch (cause) {
    useRustCleanup.setState({ error: `Clean-up failed: ${String(cause)}` })
  }
}
