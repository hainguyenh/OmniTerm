import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { dispatchTerminalCopy, type TerminalCopyAction } from '../utils/terminalCopyExtract'
import { Tooltip } from './Tooltip'

interface TerminalCopyMenuProps {
  sessionId: string
  placement?: 'top' | 'bottom'
  /** Render as a row inside SessionControlButtons' "More terminal actions" overflow menu. */
  menuItem?: boolean
}

const ITEMS: Array<{ action: TerminalCopyAction; label: string; hint?: string }> = [
  { action: 'last-output', label: 'Copy last output' },
  { action: 'viewport', label: 'Copy all terminal', hint: 'current screen, no scrollback' },
]

/**
 * Pane-header copy control: a chrome Copy icon that opens a compact dropdown (mirroring
 * SessionPersistenceMenu's popover, outside-click and Escape dismissal included) offering the
 * spec'd two actions. Selecting one dispatches `omniterm:copy-terminal`; the owning TerminalView
 * computes the text and writes the clipboard — see utils/terminalCopyExtract.ts.
 */
export default function TerminalCopyMenu({ sessionId, placement = 'bottom', menuItem = false }: TerminalCopyMenuProps) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Mirror SessionPersistenceMenu's outside-click / Escape dismissal so the dropdown never relies
  // on hover away; both listeners exist only while it is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const pick = (action: TerminalCopyAction) => {
    dispatchTerminalCopy(sessionId, action)
    setOpen(false)
  }

  return (
    <div className={`relative ${menuItem ? 'w-full' : 'flex-shrink-0'}`}>
      <Tooltip content="Copy terminal output" placement={placement}>
        <button
          ref={btnRef}
          type="button"
          role={menuItem ? 'menuitem' : undefined}
          aria-label="Copy terminal output"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
          className={menuItem
            ? 'flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover'
            : 'w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors'}
        >
          <Copy className="w-3 h-3" />
          {menuItem && <span>Copy terminal output</span>}
        </button>
      </Tooltip>
      {open && (
        <div
          ref={popRef}
          role="menu"
          aria-label="Copy terminal output"
          className={`absolute right-0 z-[100] border rounded-lg shadow-2xl py-1 min-w-[190px] ${
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{
            backgroundColor: 'var(--theme-popup-bg)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-fg)',
          }}
        >
          {ITEMS.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              aria-label={item.hint ? `${item.label} ${item.hint}` : item.label}
              onClick={() => pick(item.action)}
              className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left text-xs text-theme-fg transition-colors hover:bg-white/5"
            >
              <span>{item.label}</span>
              {item.hint && <span className="text-[10px] text-theme-dim">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
