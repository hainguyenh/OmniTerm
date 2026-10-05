import { FolderInput } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import type { MoveDestination } from '../utils/workspaceFileEdits'
import { WorkspaceDialogError, WorkspaceDialogFooter, WorkspaceDialogFrame } from './WorkspaceDialogFrame'

/** Large trees are filtered, not scrolled through: the list stops here until the filter narrows. */
const MAX_LISTED = 300

interface MoveFileDialogProps {
  fileName: string
  /** Logical path of the folder the file is in now; listed but not selectable. */
  currentFolder: string
  destinations: MoveDestination[]
  onClose: () => void
  /** Rejects with the reason the move failed; the dialog stays open to show it. */
  onMove: (folder: string) => Promise<void>
}

export function MoveFileDialog({ fileName, currentFolder, destinations, onClose, onMove }: MoveFileDialogProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? destinations.filter(destination => destination.label.toLowerCase().includes(needle))
    : destinations
  const listed = matches.slice(0, MAX_LISTED)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await onMove(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <WorkspaceDialogFrame title="Move File" icon={FolderInput} onClose={onClose}>
      <div className="text-xs text-[var(--theme-dim)] truncate">
        Moving: <span className="font-mono text-[var(--theme-fg)]">{fileName}</span>
      </div>
      <WorkspaceDialogError message={error} />
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          type="search"
          autoFocus
          aria-label="Filter folders"
          placeholder="Filter folders"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="w-full px-2 py-1 text-xs bg-[var(--theme-input-bg,var(--theme-bg))] border border-[var(--theme-border)] rounded outline-none focus:border-[var(--theme-accent)]"
        />
        <fieldset className="max-h-60 overflow-y-auto rounded border border-[var(--theme-border)] p-1">
          <legend className="sr-only">Destination folder</legend>
          {listed.map(destination => {
            const current = destination.id === currentFolder
            return (
              <label
                key={destination.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${current ? 'text-[var(--theme-dim)]' : 'cursor-pointer hover:bg-[var(--theme-hover-bg)]'}`}
                title={destination.label}
              >
                <input
                  type="radio"
                  name="move-destination"
                  value={destination.id}
                  checked={selected === destination.id}
                  disabled={current}
                  onChange={() => setSelected(destination.id)}
                />
                <span className="truncate font-mono">{destination.label}</span>
                {current && <span className="ml-auto flex-shrink-0">(current)</span>}
              </label>
            )
          })}
          {listed.length === 0 && (
            <div className="px-2 py-1 text-xs text-[var(--theme-dim)]">No folder matches the filter.</div>
          )}
          {matches.length > listed.length && (
            <div className="px-2 py-1 text-xs text-[var(--theme-dim)]">
              Showing {listed.length} of {matches.length} folders. Filter to narrow the list.
            </div>
          )}
        </fieldset>
        <WorkspaceDialogFooter
          busy={busy}
          canSubmit={Boolean(selected)}
          submitLabel="Move"
          busyLabel="Moving…"
          onCancel={onClose}
        />
      </form>
    </WorkspaceDialogFrame>
  )
}
