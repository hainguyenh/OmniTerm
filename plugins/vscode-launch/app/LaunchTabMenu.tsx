import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardCopy,
  FolderOpen,
  Globe,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'

import type { EditorKind, LaunchRunSummary } from '../src/types'

export interface LaunchTabMenuProps {
  x: number
  y: number
  run: LaunchRunSummary
  preferredEditor?: EditorKind
  browserUrl?: string | null
  hasAttach?: boolean
  onStop: () => void
  onRestart: () => void
  onOpenInTerminal: () => void
  onOpenBrowser?: (url: string) => void
  onOpenEditor?: () => void
  onCopyAttachJson?: () => void
  onCopyLogs: () => void
  onClearLogs: () => void
  onCloseConsole: () => void
  onClose: () => void
}

const MENU_WIDTH = 210
const MENU_HEIGHT_PAD = 260

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, disabled, onClick }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover text-left transition-colors cursor-pointer select-none text-xs text-theme-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
  >
    <span className="shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
)

export const LaunchTabMenu: React.FC<LaunchTabMenuProps> = ({
  x,
  y,
  run,
  preferredEditor,
  browserUrl,
  hasAttach,
  onStop,
  onRestart,
  onOpenInTerminal,
  onOpenBrowser,
  onOpenEditor,
  onCopyAttachJson,
  onCopyLogs,
  onClearLogs,
  onCloseConsole,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const isRunning = run.status === 'starting' || run.status === 'running'
  const editorLabel = preferredEditor === 'codium' ? 'VSCodium' : 'VS Code'

  const winW = typeof window !== 'undefined' ? window.innerWidth : 800
  const winH = typeof window !== 'undefined' ? window.innerHeight : 600
  const left = Math.max(8, Math.min(x, winW - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, winH - MENU_HEIGHT_PAD - 8))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${run.name} actions`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.nativeEvent?.preventDefault?.()
        e.nativeEvent?.stopImmediatePropagation?.()
      }}
      className="fixed z-50 bg-theme-popup border border-theme-border rounded-lg shadow-2xl py-1 min-w-[200px] text-xs text-theme-fg select-none"
      style={{ left, top }}
    >
      <MenuItem
        icon={<Square className={`w-3.5 h-3.5 ${isRunning ? 'text-theme-error' : 'opacity-60'}`} />}
        label={isRunning ? 'Stop Run' : 'Stop Run (exited)'}
        disabled={!isRunning}
        onClick={() => {
          onStop()
          onClose()
        }}
      />
      <MenuItem
        icon={<RotateCw className="w-3.5 h-3.5 opacity-70" />}
        label="Restart Run"
        onClick={() => {
          onRestart()
          onClose()
        }}
      />
      <MenuItem
        icon={<Terminal className="w-3.5 h-3.5 opacity-70" />}
        label="Pop out to Terminal Tab"
        onClick={() => {
          onOpenInTerminal()
          onClose()
        }}
      />
      {browserUrl && (
        <MenuItem
          icon={<Globe className="w-3.5 h-3.5 opacity-70" />}
          label={`Open ${browserUrl} in browser`}
          onClick={() => {
            onOpenBrowser?.(browserUrl)
            onClose()
          }}
        />
      )}
      {preferredEditor && onOpenEditor && (
        <MenuItem
          icon={<FolderOpen className="w-3.5 h-3.5 opacity-70" />}
          label={`Open folder in ${editorLabel}`}
          onClick={() => {
            onOpenEditor()
            onClose()
          }}
        />
      )}
      {hasAttach && onCopyAttachJson && (
        <MenuItem
          icon={<ClipboardCopy className="w-3.5 h-3.5 opacity-70" />}
          label="Copy attach JSON"
          onClick={() => {
            onCopyAttachJson()
            onClose()
          }}
        />
      )}
      <MenuItem
        icon={<ClipboardCopy className="w-3.5 h-3.5 opacity-70" />}
        label="Copy Logs"
        onClick={() => {
          onCopyLogs()
          onClose()
        }}
      />
      <MenuItem
        icon={<Trash2 className="w-3.5 h-3.5 opacity-70" />}
        label="Clear Output"
        onClick={() => {
          onClearLogs()
          onClose()
        }}
      />
      <div className="my-1 border-t border-theme-border/60" />
      <MenuItem
        icon={<X className="w-3.5 h-3.5 text-theme-error opacity-80" />}
        label={isRunning ? 'Stop & Close Console' : 'Close Console'}
        onClick={() => {
          onCloseConsole()
          onClose()
        }}
      />
    </div>,
    document.body,
  )
}

export default LaunchTabMenu
