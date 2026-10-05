import { FolderInput, Pencil, Pin, PinOff, Play, Trash2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { WorkspaceScript } from '@omniterm/contract'

import type { WorkspaceTreeNode } from '../utils/scriptTree'
import { fileAppearance } from '../utils/fileAppearance'
import { FileTypeIcon } from './FileTypeIcon'
import { Tooltip } from './Tooltip'
import { useRowContextMenu } from './useRowContextMenu'
import { WorkspaceRowActions } from './WorkspaceRowActions'

interface WorkspaceFileRowProps {
  node: WorkspaceTreeNode
  label: string
  depth: number
  pinned: boolean
  /** A one-shot reveal request is flashing this row. */
  highlighted: boolean
  /** The file is open in the active editor tab. */
  active: boolean
  rowRef: (el: HTMLDivElement | null) => void
  onOpen: (script: WorkspaceScript) => void
  onRun: (script: WorkspaceScript) => void
  onTogglePinned: () => void
  onRename?: (name: string) => void
  onMove?: () => void
  onDelete?: () => void
}

export function WorkspaceFileRow({
  node, label, depth, pinned, highlighted, active, rowRef,
  onOpen, onRun, onTogglePinned, onRename, onMove, onDelete,
}: WorkspaceFileRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const { actionsRef, onContextMenu } = useRowContextMenu()
  const meta = fileAppearance(node.name, node.entry?.kind ?? '')
  const { script, openable } = node
  const title = openable ? `Open ${node.name}` : `${node.name} (${meta.label})`
  const runLabel = script?.kind === 'rdp' ? 'Launch' : 'Run'

  const startRename = () => {
    setDraft(node.name)
    setRenaming(true)
  }

  const submitRename = () => {
    const trimmed = draft.trim()
    setRenaming(false)
    if (trimmed && trimmed !== node.name) onRename?.(trimmed)
  }

  return (
    <div
      ref={rowRef}
      className={`workspace-file-row group flex items-center gap-2 pr-1 rounded hover:bg-[var(--theme-hover-bg)] ${openable ? 'cursor-pointer' : 'cursor-default'} ${
        highlighted
          ? 'bg-[var(--theme-accent)]/20 ring-1 ring-[var(--theme-accent)]'
          : ''
      }`}
      data-active={active || undefined}
      style={{ '--tree-depth': depth } as CSSProperties}
      onClick={() => { if (openable && !renaming) onOpen(openable) }}
      onContextMenu={renaming ? undefined : onContextMenu}
      title={title}
    >
      <FileTypeIcon name={node.name} kind={node.entry?.kind ?? ''} />
      {renaming ? (
        <input
          type="text"
          autoFocus
          aria-label="File name"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onFocus={event => {
            // Select the stem, as file managers do, so typing keeps the extension.
            const dot = draft.lastIndexOf('.')
            event.currentTarget.setSelectionRange(0, dot > 0 ? dot : draft.length)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Enter') submitRename()
              else setRenaming(false)
            }
          }}
          onBlur={submitRename}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          className="workspace-rename-input"
        />
      ) : (
        <button
          type="button"
          disabled={!openable}
          aria-current={active ? 'true' : undefined}
          onClick={event => {
            event.stopPropagation()
            if (openable) onOpen(openable)
          }}
          onKeyDown={event => {
            if (event.key === 'F2' && onRename) {
              event.preventDefault()
              startRename()
            }
          }}
          className={`workspace-file-name workspace-row-label flex-1 min-w-0 truncate text-xs ${openable ? '' : 'text-[var(--theme-dim)]'}`}
          style={openable ? { color: `color-mix(in srgb, ${meta.color} 24%, var(--theme-fg))` } : undefined}
        >
          {label}
        </button>
      )}
      {script && (
        <Tooltip content={runLabel} placement="bottom">
          <button
            type="button"
            aria-label={runLabel}
            onClick={event => { event.stopPropagation(); onRun(script) }}
            className="workspace-icon-button workspace-run-action text-[var(--theme-accent)]"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      <WorkspaceRowActions ref={actionsRef} label={`Actions for ${node.name}`} items={[
        ...(script ? [{ label: runLabel, icon: Play, onSelect: () => onRun(script) }] : []),
        { label: pinned ? 'Unpin item' : 'Pin item', icon: pinned ? PinOff : Pin,
          onSelect: onTogglePinned, active: pinned },
        ...(onRename ? [{ label: 'Rename file', icon: Pencil, onSelect: startRename }] : []),
        ...(onMove ? [{ label: 'Move file to…', icon: FolderInput, onSelect: onMove }] : []),
        ...(onDelete ? [{ label: 'Delete file', icon: Trash2, onSelect: onDelete, danger: true }] : []),
      ]} />
    </div>
  )
}
