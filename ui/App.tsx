import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import MainLayout from './components/MainLayout'
import DetachedTerminalWindow from './components/DetachedTerminalWindow'
import { ThemeRemixModal } from './components/ThemeRemixModal'
import { AppTheme, DEFAULT_THEME_ID, TOKYO_NIGHT, LayoutMode } from './themes'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { installUnifiedTheme, refreshUnifiedTheme, selectOmniTheme, setOmniThemes, useUnifiedTheme } from './platform/theme/unifiedTheme'
import { WORKBENCH_THEME_ID, legacyChoice } from './platform/theme/choice'
import { useThemeSync } from './platform/theme/useThemeSync'
import { diag } from './diag'
import { useTitleControlsProps } from './workbench/titleControlsStore'
import { setLargePasteThresholds } from './utils/largeTextPaste'
import { useBlurPlugin } from './hooks/useBlurPlugin'
import { useSettingsWindowRedirect } from './workbench/settings/useSettingsWindowRedirect'
import type { DefaultWorkspaceSetting } from './utils/workspaceSelection'
import { useWindowRounding } from './hooks/useWindowRounding'

interface AppSettings {
  themeId: string
  themeChoice?: string
  fontSize: number
  smartColors: boolean
  checkUpdatesOnStartup: boolean
  darkMode: boolean
  /** Skip the connected-terminal close confirmation dialog until the user turns it back off. */
  skipTerminalCloseConfirm?: boolean
  /** Shell inline prediction (PowerShell's PSReadLine). Applies to new panes; on by default. */
  commandCompletion?: boolean
  /** Per-connection appearance defaults (font size + theme), keyed by connection id. */
  perConn?: Record<string, TerminalAppearance>
  /** Any id from `shells.list`; the picker falls back when it is no longer available. */
  defaultShell?: string
  /** Where new terminals land when the launch site does not name a workspace itself. */
  defaultWorkspace?: DefaultWorkspaceSetting
  shortcuts?: ShortcutBindings
  zoomFactor?: number
  blurInactiveWindow?: number
  blurInactiveDock?: boolean
  blurEnabled?: boolean
  shiftEnter?: 'esc-cr' | 'lf' | 'off'
  /** Large-paste thresholds; validated by utils/largeTextPaste.ts resolveLargePaste. */
  largePaste?: { promptChars?: number; attachChars?: number }
  /** Whether the Git integration utility is enabled (Activity bar tab and status bar branch indicator). */
  gitUtilEnabled?: boolean
  /** Show the IDE workbench frame around the sessions (on unless false). */
  workbenchEnabled?: boolean
}

function App() {
  const [storedSettings, setAppSettings] = useState<AppSettings>({
    themeId: DEFAULT_THEME_ID,
    fontSize: 14,
    smartColors: false,
    checkUpdatesOnStartup: true,
    darkMode: true,
    defaultShell: 'powershell',
    gitUtilEnabled: true,
  })
  const [themes, setThemes] = useState<AppTheme[]>([TOKYO_NIGHT])
  const [themesLoaded, setThemesLoaded] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // The workbench's `appearance.theme` is the one theme setting; the OmniTerm theme and mode every
  // terminal and panel paints from are derived from it (see platform/theme/unifiedTheme.ts).
  // Non-null only when this renderer is a popped-out terminal window. Read synchronously — the
  // bridge derives it from the window label, so no await is needed before choosing a root view.
  const isDetachedWindow = (window.omnitermAPI?.terminalWindow?.detachedSessionId ?? null) !== null
  const unified = useUnifiedTheme()
  const appSettings = useMemo<AppSettings>(
    () => ({ ...storedSettings, themeId: unified.themeId, darkMode: unified.mode === 'dark' }),
    [storedSettings, unified.themeId, unified.mode],
  )
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(1)
  const [themeRemixOpen, setThemeRemixOpen] = useState(false)
  // OmniTerm's settings live in the IDE's Settings window; the Agent Quota "Settings" link lands there.
  useSettingsWindowRedirect()
  // Per-terminal appearance (font size + theme). In-memory per-session-instance overrides on top of
  // the persisted per-connection defaults (`appSettings.perConn`), which themselves fall back to the
  // app-wide settings. Only the focused terminal's controls (TitleBar / footer / detached window)
  // write here, so each terminal keeps its own look.
  const [tabAppearance, setTabAppearance] = useState<Record<string, TerminalAppearance>>({})
  // Which terminal the TitleBar's theme/font controls target — reported up by MainLayout.
  const [activeTerminal, setActiveTerminal] = useState<{ id: string; connId: string } | null>(null)
  const [windowActive, setWindowActive] = useState(true)
  // Whole-app fullscreen: native OS fullscreen plus chrome hidden. Not persisted — a fresh launch
  // always starts windowed, matching browser/terminal conventions. Escape is the secondary exit.
  const [chromeFullscreen, setChromeFullscreen] = useState(false)
  const toggleChromeFullscreen = useCallback(() => setChromeFullscreen(v => !v), [])
  useEffect(() => {
    window.omnitermAPI?.windowControl?.setFullscreen?.(chromeFullscreen)?.catch((error: unknown) =>
      diag.warn('[window] set_fullscreen failed', error))
  }, [chromeFullscreen])
  useEffect(() => {
    if (!chromeFullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChromeFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chromeFullscreen])
  const { available: blurAvailable } = useBlurPlugin()
  const windowRounded = useWindowRounding() && !chromeFullscreen
  const startupUpdateChecked = useRef(false)
  useEffect(() => {
    const onFocus = () => setWindowActive(true)
    const onBlur = () => setWindowActive(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
  }, [])

  useEffect(() => {
    if (!appSettings.checkUpdatesOnStartup || startupUpdateChecked.current) return
    startupUpdateChecked.current = true
    void window.omnitermAPI.updates.check()
      .catch((error: unknown) => diag.warn('[updates] startup check failed', error))
  }, [appSettings.checkUpdatesOnStartup])

  // Settings can be saved from any window (a popped-out terminal writes the connection's
  // appearance). The backend broadcasts each save, so re-read here and both windows stay in sync
  // live — a change in the detached window shows up in the main window's footer/title bar and
  // vice versa, without waiting for a re-attach.
  useEffect(() => {
    return window.omnitermAPI.settings.onChanged(() => {
      window.omnitermAPI.settings.get().then((s: any) => setAppSettings(s))
    })
  }, [])

  // Read at paste time by every pane in this window (main or detached).
  useEffect(() => setLargePasteThresholds(appSettings.largePaste), [appSettings.largePaste])

  // `workbench` is the theme derived from the workbench's own themes; it is not a file on disk.
  const allThemes = useMemo(
    () => unified.themeId === WORKBENCH_THEME_ID ? [...themes, unified.appTheme] : themes,
    [themes, unified.themeId, unified.appTheme],
  )
  const currentTheme = unified.appTheme

  // Load settings and themes on mount.
  const reloadSettingsAndThemes = () => {
    window.omnitermAPI.settings.get().then((s: any) => { setAppSettings(s); setSettingsLoaded(true) })
    window.omnitermAPI.themes.list().then((t: any) => { setThemes(t); setThemesLoaded(true) })
  }

  useEffect(() => {
    reloadSettingsAndThemes()
  }, [])

  // One-time cleanup for settings saved before ad-hoc appearance stopped persisting: an ad-hoc
  // shell's id is never seen again, so a stale `adhoc-*` entry can only ever be dead weight.
  useEffect(() => {
    const stale = Object.keys(appSettings.perConn ?? {}).filter(id => id.startsWith('adhoc-'))
    if (stale.length === 0) return
    const perConn = { ...appSettings.perConn }
    for (const id of stale) delete perConn[id]
    const next = { ...appSettings, perConn }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
  }, [appSettings.perConn])

  // Apply the persisted zoom factor on mount, and whenever it changes elsewhere (another window's
  // zoom, synced back through `settings:changed`) — so every window converges on one factor and a
  // fresh window (including a detached terminal) never starts back at 1. WebView zoom changes CSS
  // pixel density with no DOM resize event, so xterm's cached char measurement goes stale without
  // this — TerminalView listens for it to force a re-measure and refit.
  useEffect(() => {
    window.omnitermAPI.app.setZoomFactor?.(appSettings.zoomFactor ?? 1)
    window.dispatchEvent(new CustomEvent('omniterm:zoom-changed'))
  }, [appSettings.zoomFactor])

  /** Persist the app-wide zoom factor — called after every zoom change (hotkey, wheel, Ctrl+0). */
  const persistZoom = (factor: number) => {
    const next = { ...appSettings, zoomFactor: factor }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
  }

  /** Reset the app chrome's zoom to 100% — the TitleBar/footer zoom indicator's click target. */
  const resetZoom = () => {
    window.omnitermAPI.app.setZoomFactor?.(1)
    persistZoom(1)
  }

  // ── Per-terminal appearance ─────────────────────────────────────────────────
  // A tab's effective look: its in-memory override layered over the connection's persisted
  // defaults, which fall back to the app-wide settings. `perConn` is a plain settings key, so the
  // backend's shallow JSON merge persists it with no schema change.
  const appearanceOf = (id: string, connId: string): TerminalAppearance => ({
    ...(appSettings.perConn?.[connId] ?? {}),
    ...(tabAppearance[id] ?? {}),
  })

  /**
   * Persist a connection's appearance override — except an ad-hoc shell's (`adhoc-<uuid>`, minted
   * fresh per launch by the backend), which can never be seen again. Persisting it would only grow
   * `settings.json` forever with dead keys; its look survives for this session via `tabAppearance`.
   */
  const persistConnAppearance = (connId: string, patch: TerminalAppearance) => {
    if (connId.startsWith('adhoc-')) return
    const next = {
      ...appSettings,
      perConn: {
        ...appSettings.perConn,
        [connId]: { ...(appSettings.perConn?.[connId] ?? {}), ...patch },
      },
    }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
  }

  /** Apply an absolute font size to `target` (or the focused terminal, or the app-wide default). */
  const setFontSize = (nextSize: number, target?: { id: string; connId: string }) => {
    const t = target ?? activeTerminal
    const size = Math.max(8, Math.min(48, Math.round(nextSize)))
    if (!t) {
      const next = { ...appSettings, fontSize: size }
      setAppSettings(next)
      window.omnitermAPI.settings.save(next)
      return
    }
    setTabAppearance(prev => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), fontSize: size } }))
    persistConnAppearance(t.connId, { fontSize: size })
  }

  /** Shift the font size of `target` (or the focused terminal, or the app-wide default). */
  const changeFontSize = (delta: number, target?: { id: string; connId: string }) => {
    const t = target ?? activeTerminal
    const current = t
      ? (appearanceOf(t.id, t.connId).fontSize ?? appSettings.fontSize ?? 14)
      : (appSettings.fontSize ?? 14)
    setFontSize(current + delta, t ?? undefined)
  }

  /** Clear the focused terminal's font-size override, falling back to its connection/app default. */
  const resetFontSize = () => {
    const t = activeTerminal
    if (!t || !tabAppearance[t.id]?.fontSize) return
    setTabAppearance(prev => {
      const { fontSize: _drop, ...rest } = prev[t.id] ?? {}
      return { ...prev, [t.id]: rest }
    })
  }

  /** Switch `target`'s theme (or the focused terminal's, or the app-wide default). */
  const applyTheme = (themeId: string, target?: { id: string; connId: string }) => {
    const t = target ?? activeTerminal
    if (!t) {
      void selectOmniTheme(themeId, unified.mode)
      return
    }
    setTabAppearance(prev => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), themeId } }))
    persistConnAppearance(t.connId, { themeId })
  }

  /** Apply an absolute font size to every open terminal — the AppearanceMenu's "apply to all". Sets
   * the app-wide default and clears every in-session override, so every terminal converges on it. */
  const applyFontSizeToAll = (size: number) => {
    const next = { ...appSettings, fontSize: Math.max(8, Math.min(48, Math.round(size))) }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
    setTabAppearance(prev => {
      const cleared: typeof prev = {}
      for (const [id, a] of Object.entries(prev)) {
        const { fontSize: _drop, ...rest } = a
        cleared[id] = rest
      }
      return cleared
    })
  }

  /** Switch every open terminal's theme — the TitleBar's theme picker targets all terminals (a
   * pane's own picker in its header still targets just that pane). Parallels applyFontSizeToAll. */
  const applyThemeToAll = (themeId: string) => {
    void selectOmniTheme(themeId, unified.mode)
    setTabAppearance(prev => {
      const cleared: typeof prev = {}
      for (const [id, a] of Object.entries(prev)) {
        const { themeId: _drop, ...rest } = a
        cleared[id] = rest
      }
      return cleared
    })
  }

  const handleActiveTerminalChange = useCallback((next: { id: string; connId: string } | null) => {
    setActiveTerminal(prev =>
      prev?.id === next?.id && prev?.connId === next?.connId ? prev : next,
    )
  }, [])

  // A detached window may have changed the connection's appearance while it was popped out; fold its
  // overrides back in by re-reading settings and dropping the tab's in-memory layer so the reloaded
  // per-connection defaults (not a stale override) win.
  const handleSettingsReload = useCallback((tabId?: string) => {
    window.omnitermAPI.settings.get().then((s: any) => setAppSettings(s))
    if (tabId) {
      setTabAppearance(prev => {
        if (!(tabId in prev)) return prev
        const next = { ...prev }
        delete next[tabId]
        return next
      })
    }
  }, [])


  // Apply the selected theme to this window's document (CSS variables and attributes only, so a
  // switch repaints in place). Windows without the workbench settings follow the settings.json copy.
  const storedChoiceRef = useRef<string>('dark')
  storedChoiceRef.current = storedSettings.themeChoice ?? legacyChoice(storedSettings.themeId, storedSettings.darkMode)
  useEffect(() => installUnifiedTheme(() => storedChoiceRef.current), [])
  useEffect(() => { if (themesLoaded) setOmniThemes(themes) }, [themes, themesLoaded])
  useEffect(() => refreshUnifiedTheme(), [storedSettings.themeChoice, storedSettings.themeId, storedSettings.darkMode])
  const patchStored = useCallback((partial: Partial<AppSettings>) => {
    setAppSettings(prev => ({ ...prev, ...partial }))
    void window.omnitermAPI.settings.save(partial as AppSettings)
  }, [])
  useThemeSync({ stored: storedSettings, loaded: settingsLoaded, enabled: !isDetachedWindow, patch: patchStored })

  // The workbench's own title bar carries the app-wide zoom, theme and mode controls, through the store below.
  useEffect(() => {
    useTitleControlsProps.setState({
      props: {
        appSettings, setAppSettings: (s) => setAppSettings(s), themes: allThemes, setThemeRemixOpen,
        zoomFactor: appSettings.zoomFactor ?? 1, onZoomReset: resetZoom,
        onFontSizeChange: changeFontSize, onThemeApply: applyThemeToAll, onApplyToAll: applyFontSizeToAll,
      },
    })
  })

  // Non-null only when this renderer is a popped-out terminal window. Read synchronously — the
  // bridge derives it from the window label, so no await is needed before choosing a root view.

  useAppShortcuts({
    appSettings, setAppSettings, changeFontSize, resetFontSize, persistZoom,
    onToggleFullscreen: toggleChromeFullscreen,
    isDetached: isDetachedWindow,
  })

  // Popped-out terminal window: render just the single-terminal view (the CSS-variable theme effect
  // above still runs, so the chrome inherits the main window's look while the terminal applies its
  // own per-window appearance — same split as tabs in the main window).
  if (isDetachedWindow) {
    return (
      <DetachedTerminalWindow
        appSettings={appSettings}
        setAppSettings={(s) => setAppSettings(s)}
        themes={allThemes}
        smartColors={appSettings.smartColors}
      />
    )
  }

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden bg-[var(--theme-bg)]${windowRounded ? ' app-window-rounded' : ''}`}>
      <div className="flex-1 min-h-0 relative">
        <div className="h-full w-full" style={{ filter: blurAvailable && !windowActive && (appSettings.blurEnabled ?? true) && (appSettings.blurInactiveWindow ?? 0) > 0 ? `blur(${appSettings.blurInactiveWindow}px)` : 'none', transition: 'filter 120ms ease-out' }}>
          <MainLayout
          chromeHidden={chromeFullscreen}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          currentTheme={currentTheme}
          themes={allThemes}
          layoutMode={layoutMode}
          setLayoutMode={setLayoutMode}
          zoomFactor={appSettings.zoomFactor ?? 1}
          onZoomReset={resetZoom}
          resolveAppearance={appearanceOf}
          onActiveTerminalChange={handleActiveTerminalChange}
          onFontSizeChange={changeFontSize}
          onThemeApply={applyTheme}
          onSettingsReload={handleSettingsReload}
          />
        </div>
      </div>
      <ThemeRemixModal
        isOpen={themeRemixOpen}
        onClose={() => setThemeRemixOpen(false)}
        themes={themes}
        setThemes={setThemes}
        appSettings={appSettings}
        setAppSettings={(s) => setAppSettings(s)}
        currentTheme={currentTheme}
      />
    </div>
  )
}

export default App
