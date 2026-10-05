import {
  ChevronDown, ChevronRight, FilePlus, Filter, FolderPlus, Loader2, Pencil, Pin, PinOff, Terminal, Unlink,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { WorkspaceFolder } from '@omniterm/contract'

import type { WorkspaceTreeNode } from '../utils/scriptTree'
import { folderAppearance } from '../utils/fileAppearance'
import { WORKSPACE_COLOR_VALUES } from '../utils/workspaceAppearance'
import { Tooltip } from './Tooltip'
import { useRowContextMenu } from './useRowContextMenu'
import { WorkspaceRowActions } from './WorkspaceRowActions'

interface WorkspaceFolderRowProps {
  node: WorkspaceTreeNode
  expanded: boolean
  loading: boolean
  /** Set for a workspace folder root; subfolders get no alias, filter or unlink actions. */
  rootFolder?: WorkspaceFolder
  filterActive: boolean
  pinned: boolean
  connectionAction: ReactNode
  onToggle: () => void
  onOpenTerminal: () => void
  onTogglePinned: () => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onRenameAlias?: (name: string) => void
  onOpenFilterMenu: (anchor: DOMRect) => void
  onUnlink: () => void
}

/** Absolute path tooltip: every segment dim, the real folder name bold. */
function pathTooltip(path: string) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return (
    <>
      {cut >= 0 ? path.slice(0, cut + 1) : ''}
      <strong>{cut >= 0 ? path.slice(cut + 1) : path}</strong>
    </>
  )
}

export function WorkspaceFolderRow({
  node, expanded, loading, rootFolder, filterActive, pinned, connectionAction,
  onToggle, onOpenTerminal, onTogglePinned, onNewFile, onNewFolder, onRenameAlias, onOpenFilterMenu, onUnlink,
}: WorkspaceFolderRowProps) {
  // Inline alias editing is only offered on workspace folder roots.
  const [renaming, setRenaming] = useState(false)
  const [aliasDraft, setAliasDraft] = useState('')
  const { actionsRef, onContextMenu } = useRowContextMenu()
  const folderMeta = folderAppearance(node.name, expanded)
  const FolderIcon = folderMeta.icon
  const Chevron = expanded && loading ? Loader2 : expanded ? ChevronDown : ChevronRight
  const name = rootFolder?.name ?? node.name

  const startRename = () => {
    if (!rootFolder) return
    setAliasDraft(rootFolder.name)
    setRenaming(true)
  }

  const submitAlias = () => {
    const trimmed = aliasDraft.trim()
    setRenaming(false)
    if (trimmed && onRenameAlias) onRenameAlias(trimmed)
  }

  return (
    <div
      className="workspace-folder-row group flex items-center gap-1 pr-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
      onClick={onToggle}
      onContextMenu={renaming ? undefined : onContextMenu}
    >
      <Chevron className={`w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)] ${expanded && loading ? 'animate-spin' : ''}`} />
      {filterActive && (
        <Filter className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-accent)]" aria-label="Folder filter active" />
      )}
      <FolderIcon
        className="w-4 h-4 flex-shrink-0"
        style={{ color: rootFolder?.color ? WORKSPACE_COLOR_VALUES[rootFolder.color] : folderMeta.color }}
        aria-label={folderMeta.label}
      />
      {renaming ? (
        <input
          type="text"
          autoFocus
          value={aliasDraft}
          onChange={event => setAliasDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Enter') submitAlias()
              else setRenaming(false)
            }
          }}
          onBlur={submitAlias}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          aria-label="Folder alias"
          className="flex-1 min-w-0 px-1 py-0.5 text-xs bg-[var(--theme-bg)] text-[var(--theme-fg)] border border-[var(--theme-accent)] rounded outline-none"
        />
      ) : (
        <Tooltip content={rootFolder ? pathTooltip(rootFolder.path) : node.name} placement="top">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={event => { event.stopPropagation(); onToggle() }}
            className="workspace-row-label flex-1 min-w-0 truncate text-xs"
            onDoubleClick={event => {
              if (!rootFolder || !onRenameAlias) return
              event.stopPropagation()
              startRename()
            }}
          >
            {name}
          </button>
        </Tooltip>
      )}
      {pinned && <Pin className="workspace-pinned-indicator" aria-label="Pinned folder" />}
      <Tooltip content="Open terminal here" placement="bottom">
        <button
          type="button"
          aria-label="Open terminal here"
          onClick={event => { event.stopPropagation(); onOpenTerminal() }}
          className="workspace-icon-button workspace-quick-action"
        >
          <Terminal aria-hidden="true" />
        </button>
      </Tooltip>
      <WorkspaceRowActions ref={actionsRef} label={`Actions for ${name}`} items={[
        { label: 'Open terminal here', icon: Terminal, onSelect: onOpenTerminal },
        ...(onNewFile ? [{ label: 'New file…', icon: FilePlus, onSelect: onNewFile }] : []),
        ...(onNewFolder ? [{ label: 'New folder…', icon: FolderPlus, onSelect: onNewFolder }] : []),
        { label: pinned ? 'Unpin item' : 'Pin item', icon: pinned ? PinOff : Pin,
          onSelect: onTogglePinned, active: pinned },
        ...(rootFolder && onRenameAlias
          ? [{ label: 'Rename folder', icon: Pencil, onSelect: startRename }]
          : []),
        ...(rootFolder ? [
          { label: 'Folder filter & appearance…', icon: Filter, onSelect: onOpenFilterMenu },
          { label: 'Unlink folder from workspace', icon: Unlink, danger: true, onSelect: onUnlink },
        ] : []),
      ]}>
        {connectionAction}
      </WorkspaceRowActions>
    </div>
  )
}
