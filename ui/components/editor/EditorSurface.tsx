import { ChevronDown, Copy, Maximize2, Minus, Plus, Scissors, Search, TextCursorInput, Undo2, WrapText, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'

import { findEditorView, isCommandEnabled, isWrapping, runEditorCommand, type EditorCommandId } from './editorCommands'
import './editor-surface.css'

/** A host-supplied entry in the actions panel, e.g. the file editor's Git commands. */
export interface EditorSurfaceAction {
  id: string
  label: string
  Icon: LucideIcon
  /** Disabled unless the right-click landed on an editor view. */
  needsView?: boolean
  /** Runs after the panel closes, with the view under the pointer (null outside any view). */
  onSelect: (view: EditorView | null) => void
}

export interface EditorSurfaceActionGroup {
  heading: string
  items: EditorSurfaceAction[]
}

interface EditorSurfaceProps {
  children: ReactNode
  label?: string
  /** Extra actions listed under the editing commands. */
  actions?: EditorSurfaceActionGroup
}

/** Height of the built-in panel and of one extra row, for keeping the panel on screen. */
const PANEL_HEIGHT = 380
const ROW_HEIGHT = 34

const COMMANDS: { id: EditorCommandId; label: string; shortcut: string; Icon: typeof Undo2 }[] = [
  { id: 'undo', label: 'Undo', shortcut: 'Ctrl Z', Icon: Undo2 },
  { id: 'cut', label: 'Cut', shortcut: 'Ctrl X', Icon: Scissors },
  { id: 'copy', label: 'Copy', shortcut: 'Ctrl C', Icon: Copy },
  { id: 'paste', label: 'Paste', shortcut: 'Ctrl V', Icon: TextCursorInput },
  { id: 'find', label: 'Find in file', shortcut: 'Ctrl F', Icon: Search },
  { id: 'fold', label: 'Fold selection', shortcut: 'Ctrl Shift [', Icon: ChevronDown },
  { id: 'wrap', label: 'Toggle word wrap', shortcut: '', Icon: WrapText },
]

/**
 * Quiet chrome around any CodeMirror view: zoom lives in the right-click actions panel. It acts on
 * the view under the pointer (see `findEditorView`), so it needs no wiring from the editor it wraps.
 */
export function EditorSurface({ children, label = 'Editor', actions }: EditorSurfaceProps) {
  const [zoom, setZoom] = useState(100)
  const [menu, setMenu] = useState<{ x: number; y: number; view: EditorView | null } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        returnFocus.current?.focus()
      }
    }
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const panelHeight = PANEL_HEIGHT + (actions ? (actions.items.length + 1) * ROW_HEIGHT : 0)

  return (
    <div className="editor-surface" style={{ '--editor-font-size': `${13 * zoom / 100}px` } as CSSProperties}>
      <div
        ref={contentRef}
        className="editor-surface-content"
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          const target = event.target instanceof HTMLElement ? event.target : event.currentTarget
          const bounds = target.getBoundingClientRect()
          returnFocus.current = target
          setMenu({ x: bounds.left + 20, y: bounds.top + 20, view: findEditorView(target, contentRef.current) })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          setMenu({ x: event.clientX, y: event.clientY, view: findEditorView(event.target, contentRef.current) })
        }}
      >
        {children}
      </div>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="editor-command-panel"
          role="dialog"
          aria-label="Editor actions"
          style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 276)), top: Math.max(8, Math.min(menu.y, window.innerHeight - panelHeight)) }}
        >
          <div className="editor-command-heading">
            <span>{label}</span>
            <button
              type="button"
              aria-label="Close editor actions"
              onClick={() => {
                setMenu(null)
                returnFocus.current?.focus()
              }}
            >
              <X />
            </button>
          </div>
          {COMMANDS.map(({ id, label: command, shortcut, Icon }) => {
            const view = menu.view
            return (
              <button
                key={id}
                type="button"
                className="editor-command"
                disabled={!view || !isCommandEnabled(id, view.state)}
                aria-pressed={id === 'wrap' && view ? isWrapping(view.state) : undefined}
                onClick={() => {
                  setMenu(null)
                  if (view) void runEditorCommand(id, view).catch(() => view.focus())
                }}
              >
                <Icon />
                <span>{command}</span>
                <kbd>{shortcut}</kbd>
              </button>
            )
          })}
          {actions && actions.items.length > 0 && (
            <div role="group" aria-label={actions.heading}>
              <div className="editor-command-divider" />
              <div className="editor-command-group-heading">{actions.heading}</div>
              {actions.items.map(({ id, label: action, Icon, needsView, onSelect }) => (
                <button
                  key={id}
                  type="button"
                  className="editor-command"
                  disabled={needsView && !menu.view}
                  onClick={() => {
                    setMenu(null)
                    onSelect(menu.view)
                  }}
                >
                  <Icon />
                  <span>{action}</span>
                </button>
              ))}
            </div>
          )}
          <div className="editor-command-divider" />
          <div className="editor-command-zoom">
            <span>Zoom</span>
            <div className="editor-zoom" role="group" aria-label="Editor zoom">
              <button type="button" aria-label="Zoom out" disabled={zoom <= 70} onClick={() => setZoom((value) => value - 10)}><Minus /></button>
              <button type="button" aria-label={`Zoom ${zoom}%, reset to 100%`} onClick={() => setZoom(100)}>{zoom}%</button>
              <button type="button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => setZoom((value) => value + 10)}><Plus /></button>
            </div>
          </div>
          <button
            type="button"
            className="editor-command"
            onClick={() => {
              setZoom(100)
              setMenu(null)
            }}
          >
            <Maximize2 />
            <span>Reset zoom</span>
            <kbd>100%</kbd>
          </button>
        </div>, document.body,
      )}
    </div>
  )
}
