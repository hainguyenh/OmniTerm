import { ExternalLink, Plus, StickyNote, Trash2, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import type { TempNoteMeta } from '../tempNotesAPI'

import './sticky-notes.css'

interface TempNotesPopoverProps {
  anchorRect: DOMRect | null
  onClose: () => void
}

function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  return `${Math.floor(diffHour / 24)}d ago`
}

export const TempNotesPopover: React.FC<TempNotesPopoverProps> = ({ anchorRect, onClose }) => {
  const [notes, setNotes] = useState<TempNoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const popoverRef = useRef<HTMLDivElement>(null)

  const loadNotes = () => {
    window.omnitermAPI.tempNotes
      .list()
      .then((data) => {
        setNotes(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    loadNotes()
    const handleChanged = () => loadNotes()
    window.addEventListener('omniterm:temp-notes-changed', handleChanged)
    return () => window.removeEventListener('omniterm:temp-notes-changed', handleChanged)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const top = anchorRect ? Math.max(10, Math.min(window.innerHeight - 380, anchorRect.top)) : 50
  const left = anchorRect ? anchorRect.right + 8 : 56

  const handleOpenSticky = (id: string) => {
    window.dispatchEvent(new CustomEvent('omniterm:open-sticky-note', { detail: { id } }))
    onClose()
  }

  const handleOpenTab = (id: string, preview: string) => {
    window.dispatchEvent(new CustomEvent('omniterm:open-temp-tab', { detail: { id, title: preview } }))
    onClose()
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    void window.omnitermAPI.tempNotes.delete(id).then(() => {
      window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      loadNotes()
    })
  }

  const handleNewNote = () => {
    window.dispatchEvent(new CustomEvent('omniterm:new-sticky-note'))
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Temp notes"
      style={{ top, left: `clamp(12px, ${left}px, max(12px, calc(100vw - 332px)))` }}
      className="sticky-notes-popover"
    >
      {/* Header */}
      <div className="sticky-notes-popover-header">
        <div className="sticky-note-title">
          <StickyNote className="sticky-note-icon" />
          <span>Sticky Notes</span>
          <span className="sticky-notes-count">({notes.length})</span>
        </div>
        <div className="sticky-note-actions">
          <button
            type="button"
            onClick={handleNewNote}
            className="sticky-note-action"
            title="New sticky note"
            aria-label="New sticky note"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="sticky-note-action"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Note List */}
      <div className="sticky-notes-list">
        {loading ? (
          <div className="sticky-notes-empty">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="sticky-notes-empty">No temporary notes</div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="sticky-notes-row"
            >
              <button
                type="button"
                onClick={() => handleOpenSticky(note.id)}
                className="sticky-notes-open"
              >
                <span className="truncate font-medium">
                  {note.title || 'Untitled Note'}
                </span>
                <span className="sticky-notes-time">
                  {formatRelativeTime(note.mtime_ms)}
                </span>
              </button>
              <div className="sticky-note-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenTab(note.id, note.title)
                  }}
                  className="sticky-note-action"
                  title="Open in editor tab"
                  aria-label="Open in editor tab"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(note.id, e)}
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
    </div>
  )
}
