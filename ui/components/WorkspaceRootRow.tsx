import { useState, type DragEventHandler, type KeyboardEvent } from 'react'
import {
  Briefcase, ChevronDown, ChevronRight, Code2, Folder, FolderGit2, FolderPlus, GripVertical, Layers3,
  Pencil, Server, Star, Trash2,
} from 'lucide-react'
import type { Workspace } from '@omniterm/contract'
import { WORKSPACE_COLOR_VALUES } from '../utils/workspaceAppearance'
import { Tooltip } from './Tooltip'

interface WorkspaceRootRowProps {
  workspace: Workspace
  expanded: boolean
  depth?: number
  canMoveUp?: boolean
  canMoveDown?: boolean
  connectionAction?: React.ReactNode
  onToggle: () => void
  onAddFolder: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onRename?: (workspaceId: string, name: string) => void
  onDragStart?: DragEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
}

export default function WorkspaceRootRow({
  workspace,
  expanded,
  depth = 0,
  connectionAction,
  onToggle,
  onAddFolder,
  onRemove,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onContextMenu,
}: WorkspaceRootRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingName, setEditingName] = useState(workspace.name)

  const title = workspace.folders.length === 1
    ? workspace.folders[0].path
    : `${workspace.folders.length} folders`
  const actionClass = 'hidden group-hover:inline-flex flex-shrink-0 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition disabled:opacity-20 disabled:pointer-events-none'
  const WorkspaceIcon = workspace.icon ? {
    folder: Folder,
    briefcase: Briefcase,
    layers: Layers3,
    code: Code2,
    server: Server,
    star: Star,
  }[workspace.icon] : null

  const startRename = () => {
    setIsEditing(true)
    setEditingName(workspace.name)
  }

  const submitRename = () => {
    const trimmed = editingName.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== workspace.name) {
      onRename?.(workspace.id, trimmed)
    }
  }

  const cancelRename = () => {
    setIsEditing(false)
    setEditingName(workspace.name)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      submitRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelRename()
    }
  }

  return (
    <div
      draggable={!isEditing}
      data-workspace-id={workspace.id}
      className="group sticky top-0 z-10 bg-[var(--theme-sidebar-bg)] flex items-center gap-1 h-8 pr-2 mx-1 rounded cursor-pointer hover:bg-[var(--theme-bg)]"
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={onToggle}
      onDragStart={isEditing ? undefined : onDragStart}
      onDragOver={isEditing ? undefined : onDragOver}
      onDrop={isEditing ? undefined : onDrop}
      onContextMenu={isEditing ? undefined : onContextMenu}
      title={title}
    >
      {WorkspaceIcon ? (
        <WorkspaceIcon
          className="h-4 w-4 flex-shrink-0"
          style={{ color: workspace.color ? WORKSPACE_COLOR_VALUES[workspace.color] : 'var(--theme-accent)' }}
          aria-label="Workspace custom icon"
        />
      ) : (
        <GripVertical
          className="h-3 w-3 flex-shrink-0 text-[var(--theme-dim)] opacity-50"
          aria-label="Workspace drag handle"
        />
      )}
      {expanded
        ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />
        : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />}
      <FolderGit2 className="h-4 w-4 flex-shrink-0 text-[var(--theme-accent)]" aria-label="Workspace icon" />
      {isEditing ? (
        <input
          type="text"
          autoFocus
          value={editingName}
          onChange={event => setEditingName(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={submitRename}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-[var(--theme-bg)] text-[var(--theme-fg)] border border-[var(--theme-accent)] rounded outline-none"
        />
      ) : (
        <Tooltip content={title} placement="top">
          <span
            className="flex-1 min-w-0 truncate text-sm"
            onDoubleClick={event => {
              event.stopPropagation()
              startRename()
            }}
          >
            {workspace.name}
          </span>
        </Tooltip>
      )}
      {connectionAction}
      {onRename && (
        <Tooltip content="Rename workspace" placement="bottom">
          <button
            type="button"
            aria-label="Rename workspace"
            onClick={event => { event.stopPropagation(); startRename() }}
            className={actionClass}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip content="Add folder to workspace" placement="bottom">
        <button
          type="button"
          aria-label="Add folder to workspace"
          onClick={event => { event.stopPropagation(); onAddFolder() }}
          className={actionClass}
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip content="Remove from workspaces" placement="bottom">
        <button
          type="button"
          aria-label="Remove from workspaces"
          onClick={event => { event.stopPropagation(); onRemove() }}
          className={`${actionClass} hover:text-red-400`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-[var(--theme-dim)] font-mono font-medium flex-shrink-0" title={`${workspace.folders.length} folder(s)`}>
        {workspace.folders.length}
      </span>
    </div>
  )
}
