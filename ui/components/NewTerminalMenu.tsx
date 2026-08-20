import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderOpen, Search, Terminal } from 'lucide-react'
import type { Workspace } from '@omniterm/contract'

import type { ShellOption } from '../shellOptions'
import { orderedWorkspaceRows } from '../utils/workspaceHierarchy'
import { encodeWorkspaceSelection } from '../utils/workspaceSelection'

interface NewTerminalMenuProps {
  anchor: { x: number; y: number }
  shellOptions: ShellOption[]
  workspaces: Workspace[]
  selectedWorkspaceId: string | null
  onSelectWorkspace: (value: string | null) => void
  onLaunchShell: (shell: string) => void
  onClose: () => void
}

interface WorkspaceFolderRow {
  workspace: Workspace
  folder: Workspace['folders'][number]
  depth: number
  selection: string
}

function workspaceFolderRows(workspaces: Workspace[]): WorkspaceFolderRow[] {
  return orderedWorkspaceRows(workspaces).flatMap(({ workspace, depth }) => workspace.folders.map(folder => ({
    workspace,
    folder,
    depth,
    selection: encodeWorkspaceSelection(workspace.id, folder.id),
  })))
}

export default function NewTerminalMenu({
  anchor,
  shellOptions,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onLaunchShell,
  onClose,
}: NewTerminalMenuProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const rows = useMemo(() => workspaceFolderRows(workspaces), [workspaces])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows
    return rows.filter(({ workspace, folder }) => [
      workspace.name,
      folder.name,
      folder.path,
    ].some(value => value.toLocaleLowerCase().includes(normalizedQuery)))
  }, [normalizedQuery, rows])

  useEffect(() => {
    searchRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const menuWidth = 300
  const left = Math.min(Math.max(anchor.x, 8), Math.max(8, window.innerWidth - menuWidth - 8))
  const opensAbove = anchor.y > window.innerHeight / 2
  const maxMenuHeight = Math.min(window.innerHeight * 0.7, 448)
  const availableHeight = opensAbove ? anchor.y - 16 : window.innerHeight - anchor.y - 8
  const position = opensAbove
    ? {
        left,
        bottom: Math.max(8, window.innerHeight - anchor.y + 8),
        maxHeight: Math.max(48, Math.min(maxMenuHeight, availableHeight)),
      }
    : {
        left,
        top: Math.min(anchor.y, window.innerHeight - 8),
        maxHeight: Math.max(48, Math.min(maxMenuHeight, availableHeight)),
      }

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      data-testid="shell-menu-backdrop"
      onClick={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <div
        data-testid="new-terminal-menu"
        role="dialog"
        aria-label="New terminal options"
        className="absolute w-[min(18rem,calc(100vw-1rem))] max-h-[min(70vh,28rem)] overflow-y-auto custom-scrollbar bg-theme-popup border border-theme-border rounded-lg shadow-xl p-1.5 text-xs font-medium"
        style={position}
        onClick={event => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-theme-popup pb-1.5">
          <div className="flex items-center gap-2 rounded-md border border-theme-border bg-theme-panel px-2 py-1.5">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              role="searchbox"
              aria-label="Search workspace or folder"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search workspace or folder"
              className="min-w-0 flex-1 bg-transparent text-theme-fg outline-none placeholder:text-theme-dim"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-theme-dim">Workspace</div>
        <div role="listbox" aria-label="Workspace and folder">
          <button
            type="button"
            role="option"
            aria-selected={selectedWorkspaceId === null}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-theme-fg hover:bg-theme-hover"
            onClick={() => onSelectWorkspace(null)}
          >
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">None (default directory)</span>
            {selectedWorkspaceId === null && <Check className="h-3.5 w-3.5 flex-shrink-0 text-theme-accent" aria-hidden="true" />}
          </button>
          {filteredRows.map(({ workspace, folder, depth, selection }) => (
            <button
              key={selection}
              type="button"
              role="option"
              aria-selected={selection === selectedWorkspaceId}
              title={folder.path}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-theme-fg hover:bg-theme-hover"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onClick={() => onSelectWorkspace(selection)}
            >
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{workspace.name} - {folder.name}</span>
              {selection === selectedWorkspaceId && <Check className="h-3.5 w-3.5 flex-shrink-0 text-theme-accent" aria-hidden="true" />}
            </button>
          ))}
          {filteredRows.length === 0 && (
            <div className="px-2 py-2 text-theme-dim">No matching workspace folders.</div>
          )}
        </div>

        <div className="my-1.5 h-px bg-theme-border" />
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-theme-dim">Shell</div>
        {shellOptions.map(option => (
          <button
            key={option.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-theme-fg hover:bg-theme-hover"
            onClick={() => { onLaunchShell(option.id); onClose() }}
          >
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
