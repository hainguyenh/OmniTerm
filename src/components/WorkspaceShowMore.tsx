import React from 'react'

interface WorkspaceShowMoreProps {
  /** Workspace whose next page this loads. */
  wsId: string
  /** Every entry the workspace holds, per the scan's `total`. */
  total: number
  /** Entries loaded so far — the row counts down the difference. */
  loaded: number
  loading: boolean
  onLoadMore: (wsId: string) => void
}

/**
 * The row at the bottom of a folder's file list that fetches that folder's next page.
 *
 * Each folder is paged independently (see useWorkspaceScan) so a huge folder is never shipped in one
 * payload; this is how "All files" and "Selected types" get to show everything without the old
 * silent truncation. The scripts and selected-file views skip this row — they are fully loaded.
 */
const WorkspaceShowMore: React.FC<WorkspaceShowMoreProps> = ({ wsId, total, loaded, loading, onLoadMore }) => (
  <div className="px-2 py-1">
    <button
      type="button"
      disabled={loading}
      onClick={() => onLoadMore(wsId)}
      className="w-full text-left text-[11px] text-[var(--theme-dim)] hover:text-[var(--theme-accent)] transition-colors"
    >
      {loading ? 'Loading…' : `Show more (${total - loaded} remaining)`}
    </button>
  </div>
)

export default WorkspaceShowMore
