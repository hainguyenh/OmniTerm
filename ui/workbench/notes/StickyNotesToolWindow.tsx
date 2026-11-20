import { Plus } from 'lucide-react'

import { TempNotesList } from '../../components/TempNotesList'

import { useTempNotesList } from './useTempNotesList'

/** Sticky Notes tool window: the list of temporary notes with a button for a new one. */
export function StickyNotesToolWindow() {
  const { notes, loading, reload } = useTempNotesList()
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sticky-notes-window">
      <div className="flex flex-none items-center justify-between px-3 py-1.5 text-xs">
        <span className="text-[var(--fg-muted)]">{`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--bg-hover)]"
          aria-label="New sticky note"
          onClick={() => window.dispatchEvent(new CustomEvent('omniterm:new-temp-note'))}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TempNotesList notes={notes} loading={loading} onChanged={reload} />
      </div>
    </div>
  )
}
