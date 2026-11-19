import { listen } from '@tauri-apps/api/event'

import { upsertTask } from '../ide/workbench/tasks'

import { formatBytes } from './sessions/sessionCleanupModel'

/** How far a clean-up job has got, as the backend's `*:progress` events report it. */
export interface JobProgress {
  done: number
  total: number
  bytes: number
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** A progress event payload, or null when it is not one (IPC data is validated here). */
export function parseProgress(raw: unknown): JobProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isCount(r.done) || !isCount(r.total) || !isCount(r.bytes)) return null
  return { done: r.done, total: r.total, bytes: r.bytes }
}

/**
 * Calls `onProgress` for every `event` until the returned function is called. It never throws:
 * without the Tauri runtime (tests, a plain browser) the job just shows no progress.
 */
export function followProgress(event: string, onProgress: (progress: JobProgress) => void): () => void {
  let unlisten: (() => void) | null = null
  let stopped = false
  try {
    listen<unknown>(event, ({ payload }) => {
      const progress = parseProgress(payload)
      if (progress && !stopped) onProgress(progress)
    }).then(
      (stop) => {
        if (stopped) stop()
        else unlisten = stop
      },
      () => undefined,
    )
  } catch {
    // No event bridge: the job still runs, without progress.
  }
  return () => {
    stopped = true
    unlisten?.()
  }
}

/** "120 of 500 entries · 1.2 GB": a job's progress in words. */
export function progressText(progress: JobProgress | null, unit: string, bytesLabel: string): string {
  if (!progress || !progress.total) return 'Starting…'
  const bytes = progress.bytes ? ` · ${formatBytes(progress.bytes)} ${bytesLabel}` : ''
  return `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} ${unit}${bytes}`
}

export interface JobTask {
  id: string
  title: string
  unit: string
  bytesLabel: string
  cancel: () => void
}

/**
 * Shows the job in the status bar's Background Tasks (with a progress bar and Cancel), so its
 * dialog can be hidden while it runs. `'done'` ends it.
 */
export function showJobTask(task: JobTask, progress: JobProgress | null | 'done'): void {
  if (progress === 'done') {
    upsertTask({ id: task.id, title: task.title, message: null, fraction: 1, done: true })
    return
  }
  upsertTask({
    id: task.id,
    title: task.title,
    message: progressText(progress, task.unit, task.bytesLabel),
    fraction: progress && progress.total ? Math.min(1, progress.done / progress.total) : null,
    done: false,
    cancel: task.cancel,
  })
}
