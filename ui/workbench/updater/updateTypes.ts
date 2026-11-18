import type { UpdateCheck, UpdateInfo, UpdateProgress, UpdateSource } from '../../ide/bindings'
import { t } from '../../ide/platform/i18n'

export type { UpdateCheck, UpdateInfo, UpdateProgress, UpdateSource }

export const UPDATE_KEY = 'app.update'
export const CHECK_TASK_ID = 'app.update.check'
export const INSTALL_TASK_ID = 'app.update.install'

export interface ProgressSummary {
  message: string
  fraction: number | null
}

export function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export function progressText(p: UpdateProgress): ProgressSummary {
  if (p.type === 'installing') {
    return { message: t('app.update.installingMessage'), fraction: null }
  }
  const done = p.downloaded ?? 0
  if (p.total && p.total > 0) {
    const fraction = Math.min(1, Math.max(0, done / p.total))
    return {
      message: t('app.update.progress', { done: megabytes(done), total: megabytes(p.total) }),
      fraction,
    }
  }
  return {
    message: t('app.update.progressUnknown', { done: megabytes(done) }),
    fraction: null,
  }
}
