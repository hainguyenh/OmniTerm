import { Icon } from '../ide/ui'

import { toggleThemeMode } from '../platform/theme/unifiedTheme'

import AppearanceMenu, { FontSizeControl } from './AppearanceMenu'
import { Tooltip } from './Tooltip'

export interface TitleControlsProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  themes: any[]
  setThemeRemixOpen: (open: boolean) => void
  /** App chrome zoom factor (1 = 100%), shown as a click-to-reset percentage. */
  zoomFactor?: number
  onZoomReset?: () => void
  /**
   * Shift the app-wide font size when there's no "apply to all" (e.g. the detached window), or the
   * font size of one terminal (`target`, the pane's font size controls).
   */
  onFontSizeChange?: (delta: number, target?: { id: string; connId: string }) => void
  /** Switch every open terminal's theme. */
  onThemeApply?: (themeId: string) => void
  /** Apply an absolute font size to every open terminal, clearing their per-terminal overrides. */
  onApplyToAll?: (size: number) => void
  /**
   * Workbench title bar: the IDE gear menu owns theme and light/dark, so neither a theme list nor
   * the mode toggle is rendered; only the terminal font size and, while not 100%, the zoom chip.
   */
  compact?: boolean
}

/** The app-wide zoom, theme, font size and light/dark controls, shared by both title bars. */
export function TitleControls({
  appSettings,
  setAppSettings,
  themes,
  setThemeRemixOpen,
  zoomFactor,
  onZoomReset,
  onFontSizeChange,
  onThemeApply,
  onApplyToAll,
  compact = false,
}: TitleControlsProps) {
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
    await toggleThemeMode()
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
    <>
      {/* Zoom level — click to reset to 100% (same as Ctrl+0). */}
        {typeof zoomFactor === 'number' && !(compact && Math.round(zoomFactor * 100) === 100) && (
          <Tooltip content="Reset zoom to 100%" shortcut="Ctrl+0" placement="bottom">
            <button
              type="button"
              onClick={onZoomReset}
              className="inline-flex items-center justify-center h-6 px-1.5 rounded-lg border text-[10px] font-mono transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
            >
              {Math.round(zoomFactor * 100)}%
            </button>
          </Tooltip>
        )}

      {/* Theme + font size — applies to every open terminal. A pane's own header has the control
            that targets just that one. */}
        {compact ? (
          <FontSizeControl fontSize={fontSize} scopeLabel="all terminals" onFontSizeChange={updateFontSize} compact />
        ) : (
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
        )}

      {/* Mode Toggle */}
        {!compact && <Tooltip content={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'} shortcut="Ctrl+/" placement="bottom">
          <button
            type="button"
            onClick={handleToggleMode}
            aria-label={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            className="inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
          >
            {isLightMode ? (
              <Icon name="moon" size={14} />
            ) : (
              <Icon name="sun" size={14} />
            )}
          </button>
        </Tooltip>}

    </>
  )
}
