import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Tooltip } from './Tooltip'

interface WorkspaceSearchBarProps {
  query: string
  onChange: (query: string) => void
}

export const SEARCH_HINT = 'Search folders, files, connections (Ctrl+Shift+F)'

export default function WorkspaceSearchBar({ query, onChange }: WorkspaceSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="workspace-search">
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onChange('')
          }
        }}
        aria-label="Search workspace"
        title={SEARCH_HINT}
        placeholder="Find in workspace…"
      />
      {query && (
        <Tooltip content="Clear search (Esc)" placement="bottom">
          <button
            type="button"
            aria-label="Clear search (Esc)"
            className="workspace-icon-button"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
