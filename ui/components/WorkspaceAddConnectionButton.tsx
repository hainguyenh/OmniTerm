import React from 'react'
import { Cable } from 'lucide-react'
import { Tooltip } from './Tooltip'

interface WorkspaceAddConnectionButtonProps {
  label: string
  onAdd: () => void
}

const WorkspaceAddConnectionButton: React.FC<WorkspaceAddConnectionButtonProps> = ({ label, onAdd }) => (
  <Tooltip content={label} placement="bottom">
    <button
      type="button"
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onAdd() }}
      className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
    >
      <Cable className="w-3.5 h-3.5" />
    </button>
  </Tooltip>
)

export default WorkspaceAddConnectionButton
