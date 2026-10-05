import React from 'react'
import { FolderPlus } from 'lucide-react'

const WorkspaceEmptyState: React.FC<{ onAdd: () => void }> = ({ onAdd }) => (
  <div className="workspace-empty-state">
    <FolderPlus aria-hidden="true" />
    <h3>Your projects, together</h3>
    <p>Add a folder to browse files, run scripts and access project connections.</p>
    <button
      type="button"
      onClick={onAdd}
      className="workspace-empty-action"
    >
      Add workspace folder
    </button>
    <span>Or import a VS Code workspace from the options menu.</span>
  </div>
)

export default WorkspaceEmptyState
