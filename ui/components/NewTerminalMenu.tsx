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
  defaultShellId: string
  onSelectWorkspace: (value: string | null) => void
  /** `workspaceSelection` is an explicit folder choice (including null = default directory); absent when a shell row launched. */
  onLaunchShell: (shell: string, workspaceSelection?: string | null) => void
  onClose: () => void
}

interface WorkspaceFolderRow {
  workspace: Workspace
  folder: Workspace['folders'][number]
  depth: number
  selection: string
}

/**
 * One navigable row of the flat keyboard cursor: folders first ("None" included), then shells.
 * The search box keeps focus and points at the active row via `aria-activedescendant`.
 */
type MenuItem =
  | { kind: 'folder'; selection: string | null }
  | { kind: 'shell'; id: string }

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
  defaultShellId,
  onSelectWorkspace,
  onLaunchShell,
  onClose,
}: NewTerminalMenuProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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
  // Flat navigation order mirrors the rendered rows: "None" row, filtered folders, then shells.
  const items = useMemo<MenuItem[]>(() => [
    { kind: 'folder', selection: null },
    ...filteredRows.map(({ selection }) => ({ kind: 'folder' as const, selection })),
    ...shellOptions.map(option => ({ kind: 'shell' as const, id: option.id })),
  ], [filteredRows, shellOptions])
  // The menu remounts on every open, so the initializer places the cursor on the default shell;
  // an unknown default degrades to the first row instead of an out-of-range index.
  const [rawCursor, setRawCursor] = useState(() => {
    const idx = items.findIndex(item => item.kind === 'shell' && item.id === defaultShellId)
    return idx === -1 ? 0 : idx
  })
  const activeCursor = Math.min(rawCursor, Math.max(0, items.length - 1))
  const isDefaultShell = (id: string) => id === defaultShellId

  useEffect(() => {
    searchRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (items.length === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter')) return
      event.preventDefault()
      if (event.key === 'ArrowDown') {
        setRawCursor(prev => (Math.min(prev, items.length - 1) + 1) % items.length)
      } else if (event.key === 'ArrowUp') {
        setRawCursor(prev => (Math.min(prev, items.length - 1) - 1 + items.length) % items.length)
      } else {
        const item = items[activeCursor]
        if (!item) return
        if (item.kind === 'folder') {
          // Enter opens the highlighted row directly: remember the choice and launch the default
          // shell in that folder now (null = the "None" row's default directory), instead of only
          // selecting it and forcing a second trip to the shell section.
          onSelectWorkspace(item.selection)
          onLaunchShell(defaultShellId, item.selection)
          onClose()
        }
        else { onLaunchShell(item.id); onClose() }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, items, activeCursor, onSelectWorkspace, onLaunchShell, defaultShellId])

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-menu-index="${activeCursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeCursor])

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
  const rowClasses = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-theme-hover ${active ? 'bg-theme-selection text-theme-selection-fg' : 'text-theme-fg'}`

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      data-testid="shell-menu-backdrop"
      onClick={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <div
        ref={menuRef}
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
              // type="text", NOT "search": once text is typed, Chromium's native search-history
              // popup can activate on a type=search input and consume ArrowDown/ArrowUp for
              // itself — the page never sees the keydown, so the menu cursor freezes after a
              // search. autoComplete="off" is not reliably honored there; type="text" never
              // spawns the popup. The explicit role keeps the searchbox semantics.
              type="text"
              role="searchbox"
              aria-label="Search workspace or folder"
              aria-activedescendant={`new-terminal-item-${activeCursor}`}
              value={query}
              onChange={event => { setQuery(event.target.value); setRawCursor(0) }}
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
            id="new-terminal-item-0"
            data-menu-index={0}
            role="option"
            aria-selected={selectedWorkspaceId === null}
            className={rowClasses(activeCursor === 0)}
            onMouseEnter={() => setRawCursor(0)}
            onClick={() => onSelectWorkspace(null)}
          >
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">None (default directory)</span>
            {selectedWorkspaceId === null && <Check className="h-3.5 w-3.5 flex-shrink-0 text-theme-accent" aria-hidden="true" />}
          </button>
          {filteredRows.map(({ workspace, folder, depth, selection }, index) => {
            const itemIndex = index + 1
            return (
              <button
                key={selection}
                type="button"
                id={`new-terminal-item-${itemIndex}`}
                data-menu-index={itemIndex}
                role="option"
                aria-selected={selection === selectedWorkspaceId}
                title={folder.path}
                className={rowClasses(activeCursor === itemIndex)}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                onMouseEnter={() => setRawCursor(itemIndex)}
                onClick={() => onSelectWorkspace(selection)}
              >
                <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{workspace.name} - {folder.name}</span>
                {selection === selectedWorkspaceId && <Check className="h-3.5 w-3.5 flex-shrink-0 text-theme-accent" aria-hidden="true" />}
              </button>
            )
          })}
          {filteredRows.length === 0 && (
            <div className="px-2 py-2 text-theme-dim">No matching workspace folders.</div>
          )}
        </div>

        <div className="my-1.5 h-px bg-theme-border" />
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-theme-dim">Shell</div>
        {shellOptions.map((option, index) => {
          const itemIndex = filteredRows.length + 1 + index
          return (
            <button
              key={option.id}
              type="button"
              id={`new-terminal-item-${itemIndex}`}
              data-menu-index={itemIndex}
              role="option"
              aria-selected={false}
              aria-label={isDefaultShell(option.id) ? `${option.label} (default)` : undefined}
              className={rowClasses(activeCursor === itemIndex)}
              onMouseEnter={() => setRawCursor(itemIndex)}
              onClick={() => { onLaunchShell(option.id); onClose() }}
            >
              <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isDefaultShell(option.id) && (
                // Check is decorative: the button's aria-label carries the "(default)" suffix.
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-theme-accent" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
