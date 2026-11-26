import { create } from 'zustand'

import { notifications } from '../../ide/workbench/contributions'
import { followProgress, showJobTask, type JobProgress, type JobTask } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import {
  applyCleanReport,
  cancelTempJob,
  cleanTemp,
  scanTemp,
  TEMP_PROGRESS_EVENT,
  type CleanReport,
  type TempGroup,
} from './tempCleanupModel'

/** The scan or clean-up running, with how far it has got. */
export interface TempJob {
  kind: 'scan' | 'clean'
  progress: JobProgress | null
  cancelling: boolean
}

interface TempCleanupState {
  /** Whether the Clean Temp Files dialog is open (the Sessions header button opens it). */
  open: boolean
  setOpen: (open: boolean) => void
  /** The last scan's groups; null before the first scan. */
  groups: TempGroup[] | null
  /** When the groups were read (ms), for their "days ago". */
  scannedAt: number
  /** Lives here, not in the dialog: hiding the dialog leaves it running in the status bar. */
  job: TempJob | null
  status: string | null
  error: string | null
}

export const useTempCleanup = create<TempCleanupState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  groups: null,
  scannedAt: 0,
  job: null,
  status: null,
  error: null,
}))

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

const TASK: Omit<JobTask, 'title'> = {
  id: 'omniterm.tempCleanup',
  unit: 'entries',
  bytesLabel: 'freed',
  cancel: () => cancelTempJobNow(),
}

const taskFor = (kind: TempJob['kind']): JobTask => ({
  ...TASK,
  title: kind === 'scan' ? 'Scanning temp files' : 'Deleting temp files',
  bytesLabel: kind === 'scan' ? 'found' : 'freed',
})

/** Asks the running job to stop at its next file. */
export function cancelTempJobNow(): void {
  const { job } = useTempCleanup.getState()
  if (!job || job.cancelling) return
  useTempCleanup.setState({ job: { ...job, cancelling: true } })
  void cancelTempJob()
}

/** Runs `work` as the job of `kind`, with its progress in the dialog and the status bar. */
async function runJob<T>(kind: TempJob['kind'], work: () => Promise<T>): Promise<T | undefined> {
  if (useTempCleanup.getState().job) return undefined
  const task = taskFor(kind)
  useTempCleanup.setState({ job: { kind, progress: null, cancelling: false }, error: null })
  showJobTask(task, null)
  const stop = followProgress(TEMP_PROGRESS_EVENT, (progress) => {
    const { job } = useTempCleanup.getState()
    if (job?.kind !== kind) return
    useTempCleanup.setState({ job: { ...job, progress } })
    if (!job.cancelling) showJobTask(task, progress)
  })
  try {
    return await work()
  } finally {
    stop()
    showJobTask(task, 'done')
    useTempCleanup.setState({ job: null })
  }
}

/** Reads the temp folder's groups. */
export async function startTempScan(): Promise<void> {
  try {
    await runJob('scan', async () => {
      const groups = await scanTemp()
      useTempCleanup.setState({ groups, scannedAt: Date.now() })
    })
  } catch (cause) {
    useTempCleanup.setState({ error: String(cause) })
  }
}

/** What a finished clean-up says in the dialog footer and, when hidden, in a notification. */
export function cleanSummary(report: CleanReport, cancelled: boolean): string {
  const skipped = report.skipped.length
    ? ` ${plural(report.skipped.length, 'entry')} skipped (in use or refused): ${report.skipped[0]?.name}.`
    : ''
  const verb = cancelled ? 'Cancelled after removing' : 'Removed'
  return `${verb} ${plural(report.removed, 'entry')}, freed ${formatBytes(report.freedBytes)}; kept ${report.kept}.${skipped}`
}

/**
 * Deletes the entries of `keys` idle for `days`, then updates the list from the report instead
 * of scanning again. Finished while the dialog is hidden, it says so in a notification.
 */
export async function startTempClean(keys: readonly string[], days: number): Promise<void> {
  let cancelled = false
  try {
    const report = await runJob('clean', async () => {
      const result = await cleanTemp(keys, days)
      cancelled = useTempCleanup.getState().job?.cancelling === true
      return result
    })
    if (!report) return
    const status = cleanSummary(report, cancelled)
    const { groups, open } = useTempCleanup.getState()
    useTempCleanup.setState({ status, groups: groups && applyCleanReport(groups, report) })
    if (!open) {
      notifications().notify({
        group: 'tools',
        level: report.skipped.length ? 'warning' : 'info',
        title: 'Temp files cleaned',
        body: status,
        actions: [{ label: 'Show', run: () => useTempCleanup.getState().setOpen(true) }],
      })
    }
  } catch (cause) {
    useTempCleanup.setState({ error: `Clean-up failed: ${String(cause)}` })
  }
}
