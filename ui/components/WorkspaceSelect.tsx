import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { Workspace } from '@omniterm/contract'
import { orderedWorkspaceRows } from '../utils/workspaceHierarchy'
import { workspaceLocationLabel } from '../utils/workspaceDisplay'
import { decodeWorkspaceSelection, encodeWorkspaceSelection } from '../utils/workspaceSelection'

interface WorkspaceSelectProps {
  workspaces: Workspace[]
  value: string | null
  onChange: (value: string | null) => void
  compact?: boolean
}

export default function WorkspaceSelect({ workspaces, value, onChange, compact = false }: WorkspaceSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const rows = orderedWorkspaceRows(workspaces)
  const selection = decodeWorkspaceSelection(value)
  const selected = rows.find(row => row.workspace.id === selection?.workspaceId)?.workspace
  const selectedFolder = selected?.folders.find(folder => folder.id === selection?.folderId)
  const label = selected
    ? selectedFolder
      ? `${selected.name} - ${selectedFolder.name}`
      : workspaceLocationLabel(selected)
    : 'None'
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !dropdownRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  return (
    <div ref={rootRef} className="relative">
      <button ref={buttonRef} type="button" aria-label="Terminal workspace" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}
        className={`inline-flex max-w-[180px] items-center gap-1 truncate rounded-lg border border-[#bb9af7]/60 bg-[#bb9af7]/15 px-2 text-[#bb9af7] hover:border-[#bb9af7] hover:bg-[#bb9af7]/25 ${compact ? 'h-7 text-[10px]' : 'h-8 text-xs'}`}
        title={`Workspace for the next terminal: ${label}`}><span className="truncate">Workspace: {label}</span><ChevronDown className="h-3 w-3 flex-shrink-0" /></button>
      {open && createPortal(<div ref={dropdownRef} role="listbox" className="fixed z-50 mb-1 max-h-[50vh] min-w-[170px] max-w-[calc(100vw-1rem)] overflow-y-auto custom-scrollbar rounded-lg border border-[#bb9af7]/60 bg-theme-popup p-1 shadow-xl"
        style={{
          bottom: buttonRef.current ? window.innerHeight - buttonRef.current.getBoundingClientRect().top : '100%',
          left: buttonRef.current ? buttonRef.current.getBoundingClientRect().left : 0,
        }}
      >
        <button type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-theme-bg" onClick={() => { onChange(null); setOpen(false) }}>None</button>
        {rows.map(({ workspace, depth }) => {
          if (workspace.folders.length === 0) {
            return (
              <button
                type="button"
                key={workspace.id}
                disabled
                title="Add a folder to this workspace before opening a terminal"
                className="block w-full truncate rounded py-1 pr-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-45"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                {workspace.name} - No folders
              </button>
            )
          }
          return workspace.folders.map(folder => (
            <button
              type="button"
              key={`${workspace.id}:${folder.id}`}
              className="block w-full truncate rounded py-1 pr-2 text-left text-xs hover:bg-theme-bg"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => { onChange(encodeWorkspaceSelection(workspace.id, folder.id)); setOpen(false) }}
            >
              {workspace.name} - {folder.name}
            </button>
          ))
        })}
      </div>, document.body)}
    </div>
  )
}
