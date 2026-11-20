import { ExternalLink, Trash2 } from 'lucide-react'
import React from 'react'

import type { TempNoteMeta } from '../tempNotesAPI'

import './sticky-notes.css'

function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  return `${Math.floor(diffHour / 24)}d ago`
}

interface TempNotesListProps {
  notes: readonly TempNoteMeta[]
  loading: boolean
  /** Called after a note was opened, so a popover can close itself. */
  onDone?: () => void
  /** Called after a note was deleted, so the owner reloads the list. */
  onChanged: () => void
}

/** The sticky notes rows: open as a floating note, open as an editor tab, delete. */
export const TempNotesList: React.FC<TempNotesListProps> = ({ notes, loading, onDone, onChanged }) => {
  const openSticky = (id: string) => {
    window.dispatchEvent(new CustomEvent('omniterm:open-sticky-note', { detail: { id } }))
    onDone?.()
  }
  const openTab = (id: string, preview: string) => {
    window.dispatchEvent(new CustomEvent('omniterm:open-temp-tab', { detail: { id, title: preview } }))
    onDone?.()
  }
  const remove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    void window.omnitermAPI.tempNotes.delete(id).then(() => {
      window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      onChanged()
    })
  }

  return (
    <div className="sticky-notes-list">
      {loading ? (
        <div className="sticky-notes-empty">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="sticky-notes-empty">No temporary notes</div>
      ) : (
        notes.map((note) => (
          <div key={note.id} className="sticky-notes-row">
            <button type="button" onClick={() => openSticky(note.id)} className="sticky-notes-open">
              <span className="truncate font-medium">{note.title || 'Untitled Note'}</span>
              <span className="sticky-notes-time">{formatRelativeTime(note.mtime_ms)}</span>
            </button>
            <div className="sticky-note-actions">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  openTab(note.id, note.title)
                }}
                className="sticky-note-action"
                title="Open in editor tab"
                aria-label="Open in editor tab"
              >
                <ExternalLink size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => remove(note.id, e)}
                className="sticky-note-action sticky-note-action-danger"
                title="Delete note"
                aria-label="Delete note"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
