import { Check, Loader2, Save, StickyNote, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Tooltip } from '../Tooltip'

export interface TempNoteEditorTabProps {
  tabId: string
  noteId: string
  visible: boolean
  onClose: () => void
}

export function TempNoteEditorTab({ noteId, visible, onClose }: TempNoteEditorTabProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef(content)
  contentRef.current = content
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    window.omnitermAPI.tempNotes
      .read(noteId)
      .then((data) => {
        if (active) {
          setContent(data)
          contentRef.current = data
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [noteId])

  const scheduleSave = useCallback((newContent: string) => {
    setSaving(true)
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      void window.omnitermAPI.tempNotes.write(noteId, newContent).then(() => {
        setSaving(false)
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      }).catch(() => {
        setSaving(false)
      })
    }, 400)
  }, [noteId])

  const handleSaveAs = useCallback(async () => {
    try {
      const savedPath = await window.omnitermAPI.tempNotes.saveAs(noteId)
      if (savedPath) {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
        onClose()
      }
    } catch {
      // User cancelled save dialog
    }
  }, [noteId, onClose])

  const handleDelete = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    void window.omnitermAPI.tempNotes.delete(noteId).then(() => {
      window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      onClose()
    })
  }, [noteId, onClose])

  const handleClose = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    const latest = contentRef.current
    if (!latest.trim()) {
      void window.omnitermAPI.tempNotes.delete(noteId).then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      })
    } else {
      void window.omnitermAPI.tempNotes.write(noteId, latest).then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
      })
    }
    onClose()
  }, [noteId, onClose])

  // Handle Ctrl+S and Tab
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void handleSaveAs()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const updated = content.substring(0, start) + '  ' + content.substring(end)
      setContent(updated)
      scheduleSave(updated)
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2
      })
    }
  }

  // Focus textarea when visible
  useEffect(() => {
    if (visible && !loading) {
      textareaRef.current?.focus()
    }
  }, [visible, loading])

  // Flush on unmount if needed
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current)
        const latest = contentRef.current
        if (!latest.trim()) {
          void window.omnitermAPI.tempNotes.delete(noteId).then(() => {
            window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
          })
        } else {
          void window.omnitermAPI.tempNotes.write(noteId, latest).then(() => {
            window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
          })
        }
      }
    }
  }, [noteId])

  const lines = content ? content.split('\n').length : 1
  const chars = content.length
  const preview = content.split('\n').find((l) => l.trim().length > 0)?.trim() || 'Untitled Note'

  const gutterRef = useRef<HTMLDivElement>(null)
  const lineNumbers = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1), [lines])

  const handleScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  if (!visible) return null

  return (
    <div className="flex flex-col h-full w-full bg-[var(--theme-bg)] text-[var(--theme-fg)] select-text">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)] select-none">
        <div className="flex items-center gap-2 min-w-0 font-medium text-xs">
          <StickyNote className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="truncate max-w-xs">{preview}</span>
          <span className="text-[10px] text-[var(--theme-dim)] px-1.5 py-0.5 rounded bg-[var(--theme-border)]/40">
            temp
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Save As… (Ctrl+S)" shortcut="Ctrl+S" placement="bottom">
            <button
              type="button"
              onClick={() => void handleSaveAs()}
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              aria-label="Save as…"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Delete note" placement="bottom">
            <button
              type="button"
              onClick={handleDelete}
              className="p-1 rounded text-red-500/80 hover:text-red-500 hover:bg-[var(--theme-hover-bg)]"
              aria-label="Delete note"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Close tab" placement="bottom">
            <button
              type="button"
              onClick={handleClose}
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              aria-label="Close tab"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 min-h-0 p-3 flex overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full w-full text-xs text-[var(--theme-dim)]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading note…
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 w-full h-full overflow-hidden">
            <div
              ref={gutterRef}
              className="flex flex-col flex-shrink-0 min-w-[28px] pr-2 mr-2 border-r border-[var(--theme-border)] text-right select-none overflow-hidden font-mono text-xs leading-relaxed text-[var(--theme-dim)] opacity-60"
              aria-hidden="true"
            >
              {lineNumbers.map((num) => (
                <div key={num} className="leading-relaxed">{num}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onScroll={handleScroll}
              onChange={(e) => {
                const val = e.target.value
                setContent(val)
                scheduleSave(val)
              }}
              onKeyDown={onKeyDown}
              placeholder="Type or paste temporary text here… (auto-saves to _temp)"
              className="flex-1 w-full h-full resize-none bg-transparent outline-none font-mono text-xs leading-relaxed placeholder:text-[var(--theme-dim)]/50"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--theme-border)] text-[10px] text-[var(--theme-dim)] bg-[var(--theme-sidebar-bg)] select-none">
        <div className="flex items-center gap-3">
          <span>{lines} {lines === 1 ? 'line' : 'lines'}</span>
          <span>{chars} characters</span>
        </div>
        <div className="flex items-center gap-1.5">
          {saving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-[var(--theme-accent)]" />
              <span>Saving to _temp…</span>
            </>
          ) : (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span>Saved to _temp</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
