import React, { useEffect, useState } from 'react'
import { Minus, Square, X, Minimize2, Loader2 } from 'lucide-react'
import TerminalView from './TerminalView'
import AppearanceMenu from './AppearanceMenu'
import type { Connection, SessionStatus } from './MainLayout'
import type { AppTheme, TerminalTheme } from '../themes'
import { detachTitle } from '../detachControl'

interface DetachedTerminalWindowProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  themes: AppTheme[]
  smartColors: boolean
}

interface Meta {
  sessionId: string
  name: string
  connection: Connection
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  closed: 'Closed',
  error: 'Error',
}

/**
 * Root view for a popped-out terminal window. It attaches to the already-running backend session
 * (never reconnects), and offers minimal chrome: re-attach (fold back into the main window) plus
 * native minimize/maximize/close, which act on this window because the backend resolves them from
 * the calling one.
 *
 * The session id is not a prop: this window learns which session it owns from `bootstrap()`, which
 * resolves it from the caller's window label. That way a webview cannot ask about a window that is
 * not its own, and there is no session id sitting in a URL.
 *
 * This window keeps its OWN appearance (font size + theme): it resolves the connection's persisted
 * overrides once it learns which session it owns, and its theme picker / font controls write those
 * overrides back — so a terminal popped out keeps its look, and the main window picks the change up
 * when it folds back in.
 */
const DetachedTerminalWindow: React.FC<DetachedTerminalWindowProps> = ({ appSettings, setAppSettings, themes, smartColors }) => {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [missing, setMissing] = useState(false)
  // In-window appearance overrides, seeded from the connection's persisted defaults once the
  // session is known. Written through `appSettings.perConn` so they survive a pop-out.
  const [override, setOverride] = useState<TerminalAppearance | null>(null)

  // Inherit the main window's zoom on open, and stay in sync if it changes while this is popped out
  // (settings.onChanged already re-reads `appSettings` for the caller — see App.tsx).
  useEffect(() => {
    window.omnitermAPI.app.setZoomFactor?.(appSettings.zoomFactor ?? 1)
  }, [appSettings.zoomFactor])

  useEffect(() => {
    window.omnitermAPI.terminalWindow.bootstrap().then((m) => {
      if (m?.sessionId) {
        setMeta(m as Meta)
        const connId = (m as Meta).connection?.id
        setOverride(connId ? appSettings.perConn?.[connId] ?? {} : {})
      } else {
        setMissing(true)
      }
    }).catch(() => setMissing(true))
  }, [])

  // Effective look of THIS window: in-window overrides over the connection's persisted defaults,
  // falling back to the app-wide settings. The chrome keeps the app-wide theme via CSS variables —
  // same as split panes in the main window.
  const connId = meta?.connection?.id
  const effective: TerminalAppearance = {
    ...(connId ? (appSettings.perConn?.[connId] ?? {}) : {}),
    ...(override ?? {}),
  }
  const themeId = effective.themeId ?? appSettings.themeId
  const fontSize = effective.fontSize ?? appSettings.fontSize ?? 14
  const theme = themes.find(t => t.id === themeId) ?? themes[0]
  const terminalTheme: TerminalTheme | undefined = theme
    ? (appSettings.darkMode ? theme.terminal.dark : theme.terminal.light)
    : undefined
  const fontFamilyMono = theme
    ? (appSettings.darkMode ? theme.ui.dark.fontFamilyMono : theme.ui.light.fontFamilyMono)
    : undefined

  const saveAppearance = (patch: TerminalAppearance) => {
    const nextOverride = { ...effective, ...patch }
    setOverride(nextOverride)
    if (!connId) return
    const nextSettings = {
      ...appSettings,
      perConn: { ...appSettings.perConn, [connId]: nextOverride },
    }
    setAppSettings(nextSettings)
    window.omnitermAPI.settings.save(nextSettings)
  }

  const changeFontSize = (delta: number) => {
    saveAppearance({ fontSize: Math.max(8, Math.min(48, fontSize + delta)) })
  }

  const applyTheme = (nextThemeId: string) => {
    saveAppearance({ themeId: nextThemeId })
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--theme-bg)]">
      {/* The window is built with decorations off, so this strip is the title bar; the drag region
          is Tauri's, declared on the element rather than via a CSS property. */}
      <div
        data-tauri-drag-region
        className="h-9 flex-shrink-0 flex items-center gap-2 px-2.5 bg-theme-sidebar border-b border-theme-border select-none"
      >
        <span data-tauri-drag-region className="text-xs font-medium text-[var(--theme-fg)] truncate min-w-0">
          {meta?.name ?? 'Terminal'}
        </span>
        <span data-tauri-drag-region className="text-[11px] text-theme-dim flex items-center gap-1">
          {status === 'connecting' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {STATUS_LABEL[status]}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Per-window appearance: this window's own theme + font size, saved to the connection. */}
          <AppearanceMenu
            themes={themes}
            themeId={themeId}
            fontSize={fontSize}
            darkMode={appSettings.darkMode}
            scopeLabel="this terminal"
            buttonTitle="Appearance — theme & font size (this terminal)"
            onThemeApply={applyTheme}
            onFontSizeChange={changeFontSize}
          />

          <button
            type="button"
            disabled={!meta}
            onClick={() => meta && window.omnitermAPI.terminalWindow.reattach(meta.sessionId)}
            className="inline-flex items-center gap-1 px-2 h-6 rounded border border-theme-border text-theme-fg text-[11px] hover:text-theme-accent hover:border-theme-accent disabled:opacity-50 transition-colors"
            title={detachTitle('attach', 'window')}
            aria-label={detachTitle('attach', 'window')}
          >
            <Minimize2 className="w-3 h-3" />
            Re-attach
          </button>
          <button type="button" onClick={() => window.omnitermAPI.windowControl.minimize()} className="inline-flex items-center justify-center w-7 h-6 rounded text-theme-fg hover:bg-[#2a2f45] transition-colors" title="Minimize">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => window.omnitermAPI.windowControl.toggleMaximize()} className="inline-flex items-center justify-center w-7 h-6 rounded text-theme-fg hover:bg-[#2a2f45] transition-colors" title="Maximize">
            <Square className="w-3 h-3" />
          </button>
          {/* Closing does not always end the session: an idle shell is reaped, a busy one folds back
              into the main window rather than losing running work to a mis-click. */}
          <button type="button" onClick={() => window.omnitermAPI.windowControl.close()} className="inline-flex items-center justify-center w-7 h-6 rounded text-theme-fg hover:bg-theme-error hover:text-white transition-colors" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {missing ? (
          <div className="h-full w-full flex items-center justify-center text-sm text-theme-error select-none">
            This session is no longer available.
          </div>
        ) : meta ? (
          <TerminalView
            id={meta.sessionId}
            connection={meta.connection}
            mode="attach"
            onStatus={setStatus}
            theme={terminalTheme}
            fontSize={fontSize}
            smartColors={smartColors}
            fontFamilyMono={fontFamilyMono}
            shortcuts={appSettings.shortcuts}
            onFontSizeChange={(size) => saveAppearance({ fontSize: size })}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-theme-dim">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

export default DetachedTerminalWindow
