import React, { useState } from 'react'
import { FileInput, FolderPlus, Plus, X } from 'lucide-react'

import WorkspaceSearchBar from './WorkspaceSearchBar'
import { Tooltip } from './Tooltip'
import { WorkspaceRowActions } from './WorkspaceRowActions'

interface WorkspacePanelHeaderProps {
  query: string
  onQueryChange: (query: string) => void
  onImport: () => void
  onAdd: () => void
  onCreate: (name: string) => void
}

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
    <div className="workspace-panel-header">
      <div className="workspace-panel-heading">
        <h2>Workspaces</h2>
        <Tooltip content="New workspace" placement="bottom">
          <button type="button" aria-label="New workspace" aria-expanded={creating} onClick={() => setCreating(value => !value)} className="workspace-icon-button workspace-primary-action">
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
        <WorkspaceRowActions label="Workspace options" items={[
          { label: 'Add workspace folder', icon: FolderPlus, onSelect: onAdd },
          { label: 'Import VS Code workspace', icon: FileInput, onSelect: onImport },
        ]} />
      </div>
      <WorkspaceSearchBar query={query} onChange={onQueryChange} />
      {creating && (
        <form className="workspace-create-form" onSubmit={submit}>
          <label htmlFor="workspace-create-name">Workspace name</label>
          <div className="workspace-create-controls">
            <input
              id="workspace-create-name"
              autoFocus
              aria-label="Workspace name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Workspace name"
              onKeyDown={event => {
              if (event.key === 'Escape') {
                setCreating(false)
                setName('')
              }
              }}
              className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--theme-accent)]"
            />
            <button type="submit" aria-label="Create workspace" disabled={!name.trim()} className="rounded px-2 py-1 text-xs text-[var(--theme-accent)] hover:bg-[var(--theme-hover-bg)] disabled:opacity-40">
              Create
            </button>
            <button
              type="button"
              aria-label="Cancel new workspace"
              className="workspace-icon-button"
              onClick={() => {
                setCreating(false)
                setName('')
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default WorkspacePanelHeader
