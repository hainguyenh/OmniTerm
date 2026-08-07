import React, { useState, useEffect } from 'react'
import { Minus, Square, Copy, X, Sun, Moon, Settings } from 'lucide-react'
import { appLogo } from '../assets/appLogo'
import AppearanceMenu from './AppearanceMenu'

interface TitleBarProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  themes: any[]
  onSettingsOpen: () => void
  setThemeRemixOpen: (open: boolean) => void
  updateState: UpdateState | null
  appVersion?: string
  /** App chrome zoom factor (1 = 100%), shown as a click-to-reset percentage. */
  zoomFactor?: number
  onZoomReset?: () => void
  /** Shift the app-wide font size when there's no "apply to all" (e.g. the detached window). */
  onFontSizeChange?: (delta: number) => void
  /** Switch every open terminal's theme. */
  onThemeApply?: (themeId: string) => void
  /** Apply an absolute font size to every open terminal, clearing their per-terminal overrides. */
  onApplyToAll?: (size: number) => void
}

export const TitleBar: React.FC<TitleBarProps> = ({
  appSettings,
  setAppSettings,
  themes,
  onSettingsOpen,
  setThemeRemixOpen,
  updateState,
  appVersion,
  zoomFactor,
  onZoomReset,
  onFontSizeChange,
  onThemeApply,
  onApplyToAll,
}) => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.omnitermAPI.windowControl.isMaximized().then(setIsMaximized)
    return window.omnitermAPI.windowControl.onMaximizedState((state) => {
      setIsMaximized(state)
    })
  }, [])

  const handleMinimize = () => window.omnitermAPI.windowControl.minimize()
  const handleToggleMaximize = () => window.omnitermAPI.windowControl.toggleMaximize()
  const handleClose = () => window.omnitermAPI.windowControl.close()

  const isLightMode = !appSettings.darkMode

  // The TitleBar's appearance control is app-wide — it always shows and changes the default that
  // every terminal without its own override uses (a pane's own picker in its header is what
  // targets a single terminal). Ignore the focused terminal's effective values here so what the
  // control displays always matches what "all terminals" will move to.
  const themeId = appSettings.themeId
  const fontSize = appSettings.fontSize ?? 14

  const applyTheme = (nextThemeId: string) => {
    if (onThemeApply) {
      onThemeApply(nextThemeId)
      return
    }
    const next = { ...appSettings, themeId: nextThemeId }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
  }

  const handleToggleMode = async () => {
    const next = { ...appSettings, darkMode: !appSettings.darkMode }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  // Always applies to every open terminal (via `onApplyToAll`), not just the focused one — the
  // per-terminal stepper lives on each pane's own header instead. Falls back to the app-wide
  // default directly when the host (e.g. the detached window) has no "apply to all" concept.
  const updateFontSize = (delta: number) => {
    const nextSize = Math.max(8, Math.min(48, fontSize + delta))
    if (onApplyToAll) {
      onApplyToAll(nextSize)
      return
    }
    if (onFontSizeChange) {
      onFontSizeChange(delta)
      return
    }
    const nextSettings = { ...appSettings, fontSize: nextSize }
    setAppSettings(nextSettings)
    window.omnitermAPI.settings.save(nextSettings)
  }

  return (
    <div
      className="h-7 flex items-center justify-between select-none border-b flex-shrink-0"
      data-tauri-drag-region
      style={{
        backgroundColor: 'var(--theme-sidebar-bg)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-fg)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Left: App Logo & Title */}
      <div className="flex items-center gap-2 pl-3 select-none pointer-events-none">
        <img src={appLogo} alt="Logo" className="w-4 h-4 object-cover" />
        <span className="text-[11px] font-bold tracking-wide uppercase opacity-90">OmniTerm</span>
        {appVersion && (
          <span className="text-[9px] opacity-50 font-medium">- v{appVersion}</span>
        )}
      </div>

      {/* Right: controls — no-drag zone */}
      <div
        className="flex h-full items-center pr-1 gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Settings button — opens Backup / About / Check for Updates */}
        <button
          type="button"
          onClick={onSettingsOpen}
          title={updateState?.updateAvailable ? "Settings (Update available!)" : "Settings"}
          className="relative inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
        >
          <Settings className="w-3.5 h-3.5" />
          {updateState?.updateAvailable && (
            <span className="absolute -bottom-0.5 -right-0.5 block h-1.5 w-1.5 rounded-full bg-theme-accent ring-1 ring-[var(--theme-popup-bg)]" />
          )}
        </button>

        {/* Zoom level — click to reset to 100% (same as Ctrl+0). */}
        {typeof zoomFactor === 'number' && (
          <button
            type="button"
            onClick={onZoomReset}
            title="Reset zoom to 100%"
            className="inline-flex items-center justify-center h-6 px-1.5 rounded-lg border text-[10px] font-mono transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
        )}

        {/* Theme + font size — applies to every open terminal. A pane's own header has the control
            that targets just that one. */}
        <AppearanceMenu
          themes={themes}
          themeId={themeId}
          fontSize={fontSize}
          darkMode={appSettings.darkMode}
          scopeLabel="all terminals"
          onThemeApply={applyTheme}
          onFontSizeChange={updateFontSize}
          onRemix={() => setThemeRemixOpen(true)}
        />

        {/* Mode Toggle */}
        <button
          type="button"
          onClick={handleToggleMode}
          title={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          className="inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
        >
          {isLightMode ? (
            <Moon className="w-3.5 h-3.5" />
          ) : (
            <Sun className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-inherit transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-inherit transition-colors"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 rotate-180" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-full flex items-center justify-center hover:bg-red-600 hover:text-white text-inherit transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
