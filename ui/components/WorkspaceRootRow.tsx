import { useState, type DragEventHandler, type KeyboardEvent } from 'react'
import {
  ArrowDown, ArrowUp, Briefcase, ChevronDown, ChevronRight, Code2, Folder, FolderGit2, FolderPlus, Layers3,
  Palette, Pencil, Server, Star, Trash2,
} from 'lucide-react'
import type { Workspace } from '@omniterm/contract'

import { WORKSPACE_COLOR_VALUES } from '../utils/workspaceAppearance'

import { Tooltip } from './Tooltip'
import { useRowContextMenu } from './useRowContextMenu'
import { WorkspaceRowActions } from './WorkspaceRowActions'

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
  onAppearance?: (anchor: DOMRect) => void
}

export default function WorkspaceRootRow({
  workspace,
  expanded,
  depth = 0,
  canMoveUp = false,
  canMoveDown = false,
  connectionAction,
  onToggle,
  onAddFolder,
  onMoveUp,
  onMoveDown,
  onRemove,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onAppearance,
}: WorkspaceRootRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingName, setEditingName] = useState(workspace.name)
  const { actionsRef, onContextMenu } = useRowContextMenu()
  const title = workspace.folders.length === 1
    ? workspace.folders[0].path
    : `${workspace.folders.length} folders`
  const WorkspaceIcon = workspace.icon ? {
    folder: Folder,
    briefcase: Briefcase,
    layers: Layers3,
    code: Code2,
    server: Server,
    star: Star,
  }[workspace.icon] : FolderGit2

  const startRename = () => {
    setIsEditing(true)
    setEditingName(workspace.name)
  }

  const submitRename = () => {
    const trimmed = editingName.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== workspace.name) onRename?.(workspace.id, trimmed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      submitRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setIsEditing(false)
      setEditingName(workspace.name)
    }
  }

  return (
    <div
      draggable={!isEditing}
      data-workspace-id={workspace.id}
      data-expanded={expanded}
      className="workspace-root-row"
      style={{ marginInlineStart: 6 + depth * 12 }}
      onClick={onToggle}
      onDragStart={isEditing ? undefined : onDragStart}
      onDragOver={isEditing ? undefined : onDragOver}
      onDrop={isEditing ? undefined : onDrop}
      onContextMenu={isEditing ? undefined : onContextMenu}
      title={title}
    >
      {isEditing ? (
        <input
          type="text"
          autoFocus
          aria-label="Workspace name"
          value={editingName}
          onChange={event => setEditingName(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={submitRename}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          className="workspace-rename-input"
        />
      ) : (
        <button
          type="button"
          className="workspace-root-toggle"
          aria-expanded={expanded}
          onClick={event => {
            event.stopPropagation()
            onToggle()
          }}
          onDoubleClick={event => {
            if (!onRename) return
            event.stopPropagation()
            startRename()
          }}
          onKeyDown={event => {
            // Keyboard counterpart of drag-and-drop ordering among sibling workspaces.
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
            const move = event.key === 'ArrowUp'
              ? canMoveUp ? onMoveUp : undefined
              : canMoveDown ? onMoveDown : undefined
            if (!move) return
            event.preventDefault()
            event.stopPropagation()
            move()
          }}
        >
          {expanded ? <ChevronDown className="workspace-chevron" /> : <ChevronRight className="workspace-chevron" />}
          <WorkspaceIcon
            className="workspace-root-icon"
            style={{ color: workspace.color ? WORKSPACE_COLOR_VALUES[workspace.color] : 'var(--theme-accent)' }}
            aria-label={workspace.icon ? 'Workspace custom icon' : 'Workspace icon'}
          />
          <span className="workspace-root-name">{workspace.name}</span>
          <span className="workspace-folder-count" title={`${workspace.folders.length} folder(s)`}>
            {workspace.folders.length}
          </span>
        </button>
      )}
      <Tooltip content="Add folder to workspace" placement="bottom">
        <button
          type="button"
          aria-label="Add folder to workspace"
          className="workspace-icon-button workspace-quick-action"
          onClick={event => {
            event.stopPropagation()
            onAddFolder()
          }}
        >
          <FolderPlus aria-hidden="true" />
        </button>
      </Tooltip>
      <WorkspaceRowActions ref={actionsRef} label={`Actions for ${workspace.name}`} items={[
        { label: 'Add folder to workspace', icon: FolderPlus, onSelect: onAddFolder },
        ...(onRename ? [{ label: 'Rename workspace', icon: Pencil, onSelect: startRename }] : []),
        ...(onAppearance ? [{ label: 'Workspace appearance…', icon: Palette, onSelect: onAppearance }] : []),
        ...(canMoveUp && onMoveUp ? [{ label: 'Move workspace up', icon: ArrowUp, onSelect: onMoveUp }] : []),
        ...(canMoveDown && onMoveDown ? [{ label: 'Move workspace down', icon: ArrowDown, onSelect: onMoveDown }] : []),
        { label: 'Remove from workspaces', icon: Trash2, onSelect: onRemove, danger: true },
      ]}>
        {connectionAction}
      </WorkspaceRowActions>
    </div>
  )
}
