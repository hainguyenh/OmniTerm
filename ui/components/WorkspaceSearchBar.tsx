import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Tooltip } from './Tooltip'

/**
 * The Workspace panel's header line: the section title, and a search that is only an icon until it is
 * wanted.
 *
 * The search used to be a permanent input below the header, which cost a whole row of a sidebar that
 * can be 180px wide and is mostly needed for the tree. Collapsed it is one icon on the title line;
 * `Ctrl+Shift+F` or a click opens it in place of the title, and Escape (or leaving it empty) puts it
 * away again — the same shape as the editor's own find bar, so nobody has to learn it.
 */
interface WorkspaceSearchBarProps {
  query: string
  onChange: (query: string) => void
}

export const SEARCH_HINT = 'Search folders, files, connections (Ctrl+Shift+F)'

const WorkspaceSearchBar: React.FC<WorkspaceSearchBarProps> = ({ query, onChange }) => {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); onChange('') }, [onChange])

  // The hotkey both opens the box and re-focuses one that is already open, so pressing it twice never
  // leaves the user typing into the tree.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (!e.shiftKey || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      setOpen(true)
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Focus follows the box opening, whichever way it was opened.
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  if (!open) {
    return (
      <>
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-dim)]">
          Workspaces
        </span>
        <Tooltip content={SEARCH_HINT} placement="bottom">
          <button
            type="button"
            aria-label="Search folders, files, connections (Ctrl+Shift+F)"
            onClick={() => setOpen(true)}
            className="flex-shrink-0 rounded p-1 text-[var(--theme-dim)] transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-[var(--theme-fg)]"
          >
            <Search className="h-4 w-4" />
          </button>
        </Tooltip>
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-1.5">
      <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-dim)]" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onChange(event.target.value)}
        // Blurring an empty box means the search was abandoned; one with a query in it stays, or the
        // results would vanish the moment the user reached for them.
        onBlur={() => { if (!query) setOpen(false) }}
        onKeyDown={(event) => { if (event.key === 'Escape') close() }}
        aria-label="Search workspace"
        placeholder="Search folders, files…"
        className="min-w-0 flex-1 bg-transparent py-1 text-xs text-[var(--theme-fg)] outline-none placeholder:italic placeholder:text-[var(--theme-dim)]"
      />
      <Tooltip content="Close search (Esc)" placement="bottom">
        <button
          type="button"
          aria-label="Close search (Esc)"
          onClick={close}
          className="flex-shrink-0 rounded p-0.5 text-[var(--theme-dim)] hover:text-[var(--theme-fg)]"
        >
          <X className="h-3 w-3" />
        </button>
      </Tooltip>
    </div>
  )
}

export default WorkspaceSearchBar
