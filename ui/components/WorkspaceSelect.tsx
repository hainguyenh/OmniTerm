import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Workspace } from '@omniterm/contract'
import { orderedWorkspaceRows } from '../utils/workspaceHierarchy'

interface WorkspaceSelectProps {
  workspaces: Workspace[]
  value: string | null
  onChange: (value: string | null) => void
  compact?: boolean
}

export default function WorkspaceSelect({ workspaces, value, onChange, compact = false }: WorkspaceSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const rows = orderedWorkspaceRows(workspaces)
  const selected = rows.find(row => row.workspace.id === value)?.workspace
  const label = selected?.folders.length === 1 ? selected.name : 'None'
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
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
      <button type="button" aria-label="Terminal workspace" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}
        className={`inline-flex max-w-[180px] items-center gap-1 truncate rounded-lg border border-[#bb9af7]/60 bg-[#bb9af7]/15 px-2 text-[#bb9af7] hover:border-[#bb9af7] hover:bg-[#bb9af7]/25 ${compact ? 'h-7 text-[10px]' : 'h-8 text-xs'}`}
        title={`Workspace for the next terminal: ${label}`}><span className="truncate">Workspace: {label}</span><ChevronDown className="h-3 w-3 flex-shrink-0" /></button>
      {open && <div role="listbox" className="absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-lg border border-[#bb9af7]/60 bg-theme-popup p-1 shadow-xl">
        <button type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-theme-bg" onClick={() => { onChange(null); setOpen(false) }}>None</button>
        {rows.map(({ workspace, depth }) => {
          const available = workspace.folders.length === 1
          return (
            <button
              type="button"
              key={workspace.id}
              disabled={!available}
              title={available ? undefined : 'Open a terminal from a folder in the Workspace panel'}
              className="block w-full truncate rounded py-1 pr-2 text-left text-xs hover:bg-theme-bg disabled:cursor-not-allowed disabled:opacity-45"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => { if (available) { onChange(workspace.id); setOpen(false) } }}
            >
              {workspace.name}
            </button>
          )
        })}
      </div>}
    </div>
  )
}
