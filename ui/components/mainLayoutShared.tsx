/* eslint-disable react-refresh/only-export-components */
import type React from 'react'
import type { Connection, Folder, LocalShell, SessionStatus } from '@omniterm/contract'
import type { AppTheme, LayoutMode } from '../themes'

export type { Connection, Folder, LocalShell, SessionStatus }

export interface MainLayoutProps {
  appSettings: AppSettings
  setAppSettings: (settings: AppSettings) => void
  currentTheme: AppTheme
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  updateState: UpdateState | null
  setUpdateState: (state: UpdateState | null) => void
  themes?: AppTheme[]
  zoomFactor?: number
  onZoomReset?: () => void
  resolveAppearance?: (id: string, connId: string) => TerminalAppearance
  onActiveTerminalChange?: (terminal: { id: string; connId: string } | null) => void
  onFontSizeChange?: (delta: number, terminal?: { id: string; connId: string }) => void
  onThemeApply?: (themeId: string, terminal?: { id: string; connId: string }) => void
  onSettingsReload?: (tabId?: string) => void
}

export const MAX_PLANES = 8
export const shortcutLabels = {
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomReset: 'Reset Zoom',
  newSession: 'New Session',
  newFolder: 'New Folder',
  openSettings: 'Open Settings',
  toggleThemeMode: 'Toggle Light/Dark',
  layout1: 'Grid 1 Layout',
  layout2: 'Grid 2 Layout',
  layout3: 'Grid 3 Layout',
  layout4: 'Grid 4 Layout',
  layout6: 'Grid 6 Layout',
  layout8: 'Grid 8 Layout',
  toggleSidebar: 'Toggle Sidebar',
  commandPalette: 'Command Palette',
  closeTab: 'Close Tab'
} satisfies Record<keyof ShortcutBindings, string>
export const DEFAULT_SHORTCUTS = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  newSession: 'Ctrl+N',
  newFolder: 'Ctrl+Shift+N',
  openSettings: 'Ctrl+,',
  toggleThemeMode: 'Ctrl+/',
  layout1: 'Ctrl+1',
  layout2: 'Ctrl+2',
  layout3: 'Ctrl+3',
  layout4: 'Ctrl+4',
  layout6: 'Ctrl+6',
  layout8: 'Ctrl+8',
  toggleSidebar: 'Ctrl+B',
  commandPalette: 'Ctrl+P',
  closeTab: 'Ctrl+W'
} satisfies ShortcutBindings

export const CtxItem: React.FC<{ label: string; icon: React.ReactNode; color: string; onClick: () => void }> =
  ({ label, icon, color, onClick }) => (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-bg/50 transition-colors ${color}`}>
      {icon}<span className="truncate">{label}</span>
    </button>
  )

export const Grid6Icon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
    <path d="M15 3v18" /><path d="M3 12h18" />
  </svg>
)

export const Grid8Icon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7.5 3v18" />
    <path d="M12 3v18" /><path d="M16.5 3v18" /><path d="M3 12h18" />
  </svg>
)

export function mintSessionId(conn: { id: string; type: Connection['type'] }): string {
  return conn.type === 'LOCAL' ? `${conn.id}_${crypto.randomUUID().slice(0, 8)}` : conn.id
}
