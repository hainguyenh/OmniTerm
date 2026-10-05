import { Maximize2, Save, StickyNote, Trash2, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import './sticky-notes.css'

interface StickyNoteWindowProps {
  id: string
  initialContent?: string
  initialPosition?: { x: number; y: number }
  onClose: () => void
  onOpenInTab: (id: string, content: string) => void
  onDelete: (id: string) => void
}

export const StickyNoteWindow: React.FC<StickyNoteWindowProps> = ({
  id,
  initialContent = '',
  initialPosition = { x: 100, y: 100 },
  onClose,
  onOpenInTab,
  onDelete,
}) => {
  const [content, setContent] = useState(initialContent)
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState(initialPosition)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const contentRef = useRef(content)
  contentRef.current = content
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    window.omnitermAPI.tempNotes
      .read(id)
      .then((data) => {
        if (active) {
          setContent(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  const scheduleSave = (newContent: string) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      void window.omnitermAPI.tempNotes.write(id, newContent).then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      })
    }, 400)
  }

  const handleClose = () => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    if (!contentRef.current.trim()) {
      void window.omnitermAPI.tempNotes.delete(id).then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      })
    } else {
      void window.omnitermAPI.tempNotes.write(id, contentRef.current).then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      })
    }
    onClose()
  }

  const handleSaveAs = async () => {
    try {
      const savedPath = await window.omnitermAPI.tempNotes.saveAs(id)
      if (savedPath) {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
        onClose()
      }
    } catch {
      // User cancelled or failed
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button')) return
    setDragging(true)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    }
  }

  useEffect(() => {
    if (!dragging) return
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPosition({
        x: Math.max(0, dragStart.current.posX + dx),
        y: Math.max(0, dragStart.current.posY + dy),
      })
    }
    const onMouseUp = () => setDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging])

  const title = content.split('\n').find((l) => l.trim().length > 0)?.trim() || 'Sticky Note'

  return (
    <div
      role="dialog"
      aria-label="Sticky note"
      style={{
        left: Math.min(Math.max(12, position.x), Math.max(12, window.innerWidth - 372)),
        top: Math.min(Math.max(12, position.y), Math.max(12, window.innerHeight - 332)),
      }}
      className="sticky-note"
    >
      {/* Header bar */}
      <div
        onMouseDown={handleMouseDown}
        className="sticky-note-header"
      >
        <div className="sticky-note-title">
          <StickyNote className="sticky-note-icon" />
          <span className="truncate">{title}</span>
        </div>
        <div className="sticky-note-actions">
          <button
            type="button"
            onClick={() => onOpenInTab(id, content)}
            className="sticky-note-action"
            title="Open as editor tab"
            aria-label="Open as editor tab"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAs()}
            className="sticky-note-action"
            title="Save as…"
            aria-label="Save as…"
          >
            <Save size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(id)}
            className="sticky-note-action sticky-note-action-danger"
            title="Delete note"
            aria-label="Delete note"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="sticky-note-action"
            title="Close note"
            aria-label="Close note"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Editor surface */}
      <div className="sticky-note-body">
        {loading ? (
          <div className="sticky-notes-empty">Loading…</div>
        ) : (
          <textarea
            autoFocus
            value={content}
            onChange={(e) => {
              const val = e.target.value
              setContent(val)
              scheduleSave(val)
            }}
            placeholder="Type or paste note here…"
            aria-label="Note content"
            className="sticky-note-editor"
          />
        )}
      </div>
    </div>
  )
}
