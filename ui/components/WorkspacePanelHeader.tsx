import React, { useState } from 'react'
import { FileInput, FolderPlus, Plus } from 'lucide-react'
import WorkspaceSearchBar from './WorkspaceSearchBar'
import { Tooltip } from './Tooltip'

interface WorkspacePanelHeaderProps {
  query: string
  onQueryChange: (query: string) => void
  onImport: () => void
  onAdd: () => void
  onCreate: (name: string) => void
}

const actionClass = 'flex-shrink-0 p-1 rounded hover:bg-[var(--theme-hover-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition-colors'

const WorkspacePanelHeader: React.FC<WorkspacePanelHeaderProps> = ({
  query, onQueryChange, onImport, onAdd, onCreate,
}) => {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
    setName('')
    setCreating(false)
  }

  return (
    <div className="border-b border-[var(--theme-border)]">
      <div className="flex items-center gap-1 px-3 py-2">
        <WorkspaceSearchBar query={query} onChange={onQueryChange} />
        <Tooltip content="Import VS Code workspace" placement="bottom">
          <button type="button" aria-label="Import VS Code workspace" onClick={onImport} className={actionClass}>
            <FileInput className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="New workspace" placement="bottom">
          <button type="button" aria-label="New workspace" onClick={() => setCreating(value => !value)} className={actionClass}>
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="Add workspace folder" shortcut="Ctrl+Shift+N" placement="bottom">
          <button type="button" aria-label="Add workspace folder" onClick={onAdd} className={actionClass}>
            <FolderPlus className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
      {creating && (
        <form className="flex items-center gap-1 px-3 pb-2" onSubmit={submit}>
          <input
            autoFocus
            aria-label="Workspace name"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Workspace name"
            className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--theme-accent)]"
          />
          <button type="submit" aria-label="Create workspace" disabled={!name.trim()} className="rounded px-2 py-1 text-xs text-[var(--theme-accent)] hover:bg-[var(--theme-hover-bg)] disabled:opacity-40">
            Create
          </button>
        </form>
      )}
    </div>
  )
}

export default WorkspacePanelHeader
