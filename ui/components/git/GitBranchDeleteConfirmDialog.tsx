import { GitBranchReviewEditor } from './GitBranchReviewEditor'

interface GitBranchDeleteConfirmDialogProps {
  open: boolean
  busy?: boolean
  selectedBranches: string[]
  forceDelete: boolean
  onForceDeleteChange: (force: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

/** The existing confirmation flow now lives in the maintenance workspace's plan editor. */
export function GitBranchDeleteConfirmDialog({
  open,
  busy = false,
  selectedBranches,
  forceDelete,
  onForceDeleteChange,
  onConfirm,
  onCancel,
}: GitBranchDeleteConfirmDialogProps) {
  if (!open) return null
  return (
    <GitBranchReviewEditor
      branches={selectedBranches}
      forceDelete={forceDelete}
      busy={busy}
      onForceDelete={onForceDeleteChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
