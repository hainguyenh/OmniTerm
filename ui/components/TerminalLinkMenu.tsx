import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, ExternalLink, FolderOpen } from 'lucide-react'
import type { TerminalLinkMenuKind } from '../utils/terminalLinks'

export type { TerminalLinkMenuKind }

export interface TerminalLinkMenuProps {
  x: number
  y: number
  kind: TerminalLinkMenuKind
  text: string
  /** Local-pane flag: when false, the OS-open action is hidden (the backend opens a path on THIS
   *  host; a path string from an SSH pane would be meaningless here). */
  isLocal: boolean
  onCopyText: (text: string) => void
  onOpenUrl: (url: string) => void
  onOpenPath: (path: string) => void
  onClose: () => void
}

// Sizing used to keep the menu inside the viewport — values are estimates, not strict.
const MENU_W = 200
const MENU_H_PAD = 96

export const TerminalLinkMenu: React.FC<TerminalLinkMenuProps> = ({
  x, y, kind, text, isLocal, onCopyText, onOpenUrl, onOpenPath, onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // capture: true so we close BEFORE the click reaches the terminal (which would otherwise refocus
    // the pane mid-close).
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H_PAD - 8))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 bg-theme-popup border border-theme-border rounded-lg shadow-2xl py-1 min-w-[180px] text-xs text-theme-fg"
      style={{ left, top }}
    >
      {kind === 'url' ? (
        <>
          <MenuItem icon={<Copy className="w-3 h-3" />} label="Copy Link" onClick={() => { onCopyText(text); onClose() }} />
          <MenuItem icon={<ExternalLink className="w-3 h-3" />} label="Open Link" onClick={() => { onOpenUrl(text); onClose() }} />
        </>
      ) : (
        <>
          <MenuItem icon={<Copy className="w-3 h-3" />} label="Copy Path" onClick={() => { onCopyText(text); onClose() }} />
          {isLocal && (
            <MenuItem icon={<FolderOpen className="w-3 h-3" />} label="Open in OS" onClick={() => { onOpenPath(text); onClose() }} />
          )}
        </>
      )}
    </div>,
    document.body,
  )
}

const MenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({
  icon, label, onClick,
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-theme-fg hover:bg-theme-bg hover:text-theme-accent transition-colors"
  >
    <span className="text-theme-dim flex-shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
)

export default TerminalLinkMenu
