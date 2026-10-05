import React from 'react'
import { Cable } from 'lucide-react'

interface WorkspaceAddConnectionButtonProps {
  label: string
  onAdd: () => void
}

const WorkspaceAddConnectionButton: React.FC<WorkspaceAddConnectionButtonProps> = ({ label, onAdd }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onAdd}
    role="menuitem"
    data-tooltip-owned="true"
    className="workspace-menu-item"
  >
    <Cable className="w-3.5 h-3.5" aria-hidden="true" />
    <span>Add connection…</span>
  </button>
)

export default WorkspaceAddConnectionButton
