import type { ReactNode } from 'react'

import { Button } from '../../ide/ui'
import { Spinner } from '../../ide/ui/Spinner'
import type { JobProgress } from '../cleanupJob'

/** A running job: spinner, what it is doing, a progress bar once it knows its total, Cancel. */
export function JobLine({
  label,
  progress,
  cancelling,
  onCancel,
}: {
  label: string
  progress: JobProgress | null
  cancelling: boolean
  onCancel?: () => void
}) {
  const fraction = progress && progress.total ? Math.min(1, progress.done / progress.total) : null
  return (
    <div className="flex flex-col gap-1" data-testid="cleanup-job">
      <div className="flex items-center gap-2">
        <Spinner label={label} />
        <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">{cancelling ? 'Cancelling…' : label}</span>
        {onCancel && (
          <Button size="small" disabled={cancelling} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {fraction !== null && (
        <div className="h-1 overflow-hidden rounded bg-[var(--border)]">
          <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** The last step before something is deleted: what goes, then Delete and Back. */
export function ConfirmBar({
  message,
  confirmLabel,
  canConfirm = true,
  onConfirm,
  onBack,
  children,
}: {
  message: string
  confirmLabel: string
  canConfirm?: boolean
  onConfirm: () => void
  onBack: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--danger)] p-2" data-testid="cleanup-confirm">
      <span className="text-[var(--danger)]">{message}</span>
      {children}
      <div className="flex justify-end gap-2">
        <Button size="small" onClick={onBack}>
          Back
        </Button>
        <Button size="small" variant="primary" disabled={!canConfirm} onClick={onConfirm} data-testid="cleanup-confirm-ok">
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

/** An empty list's text. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[var(--fg-muted)]">{children}</div>
}
