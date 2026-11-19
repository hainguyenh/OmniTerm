import { create } from 'zustand'

import { notifications } from '../../ide/workbench/contributions'
import { removeStoredSession } from '../../utils/agentSessionStorage'
import { followProgress, showJobTask, type JobProgress, type JobTask } from '../cleanupJob'

import {
  cancelSessionDelete,
  deleteSessionFiles,
  listSessionFiles,
  SESSION_PROGRESS_EVENT,
  withoutDeleted,
  type AgentSessionFile,
  type CleanupRow,
} from './sessionCleanupModel'

/** How long a scan of the agents' local session folders may take before the dialog gives up on it. */
const SCAN_TIMEOUT_MS = 120_000

/** A delete running, with how far it has got. */
export interface SessionDeleteJob {
  progress: JobProgress | null
  cancelling: boolean
}

interface SessionCleanupState {
  /** Whether the Clean Up Sessions dialog is open (the Sessions header button opens it). */
  open: boolean
  setOpen: (open: boolean) => void
  /** The conversations of the profiles last scanned; null until the first scan. */
  files: AgentSessionFile[] | null
  scanned: readonly string[]
  scannedDays: number
  scanning: boolean
  error: string | null
  /** Lives here, not in the dialog: hiding the dialog leaves it running in the status bar. */
  job: SessionDeleteJob | null
  status: string | null
}

export const useSessionCleanup = create<SessionCleanupState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  files: null,
  scanned: [],
  scannedDays: 0,
  scanning: false,
  error: null,
  job: null,
  status: null,
}))

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

let generation = 0

/**
 * Reads the conversations of `profiles` (idle for `olderThanDays`). A scan that outlives the
 * timeout is reported and its late answer dropped; a newer scan replaces an older one.
 */
export async function scanSessions(profiles: readonly string[], olderThanDays = 0): Promise<void> {
  const current = ++generation
  useSessionCleanup.setState({ scanning: true, error: null, status: null })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('the scan took too long. Scan again, or narrow it to fewer profiles')), SCAN_TIMEOUT_MS)
  })
  try {
    const files = await Promise.race([listSessionFiles(profiles, olderThanDays), timeout])
    if (current === generation) useSessionCleanup.setState({ files, scanned: profiles, scannedDays: olderThanDays })
  } catch (cause) {
    if (current === generation) {
      useSessionCleanup.setState({
        files: [],
        scanned: profiles,
        scannedDays: olderThanDays,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  } finally {
    clearTimeout(timer)
    if (current === generation) useSessionCleanup.setState({ scanning: false })
  }
}

const TASK: JobTask = {
  id: 'omniterm.sessionCleanup',
  title: 'Deleting agent sessions',
  unit: 'sessions',
  bytesLabel: 'freed',
  cancel: () => cancelSessionDeleteNow(),
}

/** Asks the running delete to stop before its next session. */
export function cancelSessionDeleteNow(): void {
  const { job } = useSessionCleanup.getState()
  if (!job || job.cancelling) return
  useSessionCleanup.setState({ job: { ...job, cancelling: true } })
  void cancelSessionDelete()
}

/** OmniTerm forgets the remembered sessions of `rows`. */
export function forgetRows(rows: readonly CleanupRow[]): void {
  rows.forEach((row) => row.storedId && removeStoredSession(row.storedId))
}

/**
 * Deletes the agent files of `rows` in one backend call (the profiles are scanned once), then
 * forgets their OmniTerm entries and drops them from the listing without scanning again.
 * Finished while the dialog is hidden, it says so in a notification.
 */
export async function deleteSessionRows(rows: readonly CleanupRow[]): Promise<void> {
  if (useSessionCleanup.getState().job) return
  const fileIds = rows.flatMap((row) => row.fileId ?? [])
  useSessionCleanup.setState({ job: { progress: null, cancelling: false }, status: null })
  showJobTask(TASK, null)
  const stop = followProgress(SESSION_PROGRESS_EVENT, (progress) => {
    const { job } = useSessionCleanup.getState()
    if (!job) return
    useSessionCleanup.setState({ job: { ...job, progress } })
    if (!job.cancelling) showJobTask(TASK, progress)
  })
  let status: string
  let failed = false
  try {
    const report = fileIds.length ? await deleteSessionFiles(fileIds) : { deleted: [], failed: [] }
    const deleted = new Set(report.deleted)
    forgetRows(rows.filter((row) => !row.fileId || deleted.has(row.fileId)))
    const { files } = useSessionCleanup.getState()
    if (files) useSessionCleanup.setState({ files: withoutDeleted(files, report.deleted) })
    const cancelled = report.failed.filter(([, reason]) => reason === 'Cancelled').length
    const refused = report.failed.length - cancelled
    failed = refused > 0
    const reason = report.failed.find(([, why]) => why !== 'Cancelled')?.[1]
    status = `Deleted ${plural(rows.length - report.failed.length, 'session')}.`
      + (cancelled ? ` Cancelled before ${plural(cancelled, 'session')}.` : '')
      + (refused ? ` ${plural(refused, 'session')} could not be deleted: ${reason}.` : '')
  } catch (cause) {
    failed = true
    status = `Delete failed: ${String(cause)}`
  } finally {
    stop()
    showJobTask(TASK, 'done')
  }
  useSessionCleanup.setState({ job: null, status })
  if (!useSessionCleanup.getState().open) {
    notifications().notify({
      group: 'tools',
      level: failed ? 'warning' : 'info',
      title: 'Agent sessions deleted',
      body: status,
      actions: [{ label: 'Show', run: () => useSessionCleanup.getState().setOpen(true) }],
    })
  }
}
