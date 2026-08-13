import React from 'react'

const WorkspaceEmptyState: React.FC<{ onAdd: () => void }> = ({ onAdd }) => (
  <button
    type="button"
    onClick={onAdd}
    className="mx-3 mt-2 w-[calc(100%-1.5rem)] rounded-md border border-dashed border-[var(--theme-border)] px-3 py-4 text-xs text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:border-[var(--theme-accent)] transition-colors"
  >
    No workspaces yet.
    <br />Add a folder or import a VS Code workspace.
  </button>
)

export default WorkspaceEmptyState
