import { Plus, StickyNote, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import type { TempNoteMeta } from '../tempNotesAPI'

import { TempNotesList } from './TempNotesList'

import './sticky-notes.css'

interface TempNotesPopoverProps {
  anchorRect: DOMRect | null
  onClose: () => void
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

      <TempNotesList notes={notes} loading={loading} onDone={onClose} onChanged={loadNotes} />
    </div>
  )
}
