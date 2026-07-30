import { useState, useEffect } from 'react'
import MainLayout from './components/MainLayout'
import DetachedTerminalWindow from './components/DetachedTerminalWindow'
import { TitleBar } from './components/TitleBar'
import { ThemeRemixModal } from './components/ThemeRemixModal'
import { AppTheme, TOKYO_NIGHT, LayoutMode } from './themes'
import { matchShortcut } from './utils/keyboard'

interface AppSettings {
  themeId: string
  fontSize: number
  smartColors: boolean
  checkUpdatesOnStartup: boolean
  darkMode: boolean
  /** Any id from `shells.list`; the picker falls back when it is no longer available. */
  defaultShell?: string
  shortcuts?: ShortcutBindings
}

function App() {
  const [appSettings, setAppSettings] = useState<AppSettings>({
    themeId: 'tokyo-night',
    fontSize: 14,
    smartColors: true,
    checkUpdatesOnStartup: true,
    darkMode: true,
    defaultShell: 'powershell',
  })
  const [themes, setThemes] = useState<AppTheme[]>([TOKYO_NIGHT])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(1)
  const [themeRemixOpen, setThemeRemixOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const unsub = window.omnitermAPI.updates.onState((s) => {
      setUpdateState(s)
    })
    window.omnitermAPI.updates.state().then((s) => {
      setUpdateState(s)
    })
    return unsub
  }, [])

  const currentTheme = themes.find(t => t.id === appSettings.themeId) ?? TOKYO_NIGHT

  // Load settings and themes on mount.
  const reloadSettingsAndThemes = () => {
    window.omnitermAPI.settings.get().then((s: any) => setAppSettings(s))
    window.omnitermAPI.themes.list().then((t: any) => setThemes(t))
  }

  useEffect(() => {
    reloadSettingsAndThemes()
  }, [])

  // Dynamically update document CSS variables when the current theme changes.
  useEffect(() => {
    if (!currentTheme) return
    const root = document.documentElement
    
    // Support new light/dark subproperties
    const isDark = appSettings.darkMode
    const t = isDark ? currentTheme.terminal.dark : currentTheme.terminal.light
    const u = isDark ? currentTheme.ui.dark : currentTheme.ui.light

    // Helper to check color luminance
    const isColorLight = (hex: string): boolean => {
      const color = hex.substring(1)
      if (color.length === 3) {
        const r = parseInt(color[0] + color[0], 16)
        const g = parseInt(color[1] + color[1], 16)
        const b = parseInt(color[2] + color[2], 16)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
      }
      if (color.length === 6) {
        const r = parseInt(color.substring(0, 2), 16)
        const g = parseInt(color.substring(2, 4), 16)
        const b = parseInt(color.substring(4, 6), 16)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
      }
      return false
    }

    // Terminal colors
    root.style.setProperty('--theme-bg', t.background)
    root.style.setProperty('--theme-fg', t.foreground)
    root.style.setProperty('--theme-border', u?.border || t.brightBlack || t.selectionBackground)
    root.style.setProperty('--theme-selection', t.selectionBackground)
    root.style.setProperty('--theme-hover-bg', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)')
    root.style.setProperty('--theme-selection-fg', isDark ? '#ffffff' : t.foreground)

    // UI Layout Customizations
    if (u) {
      root.style.setProperty('--theme-font-family', u.fontFamily)
      root.style.setProperty('--theme-font-mono', u.fontFamilyMono || '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace')
      root.style.setProperty('--theme-rounded-sm', u.borderRadiusSm)
      root.style.setProperty('--theme-rounded-md', u.borderRadiusMd)
      root.style.setProperty('--theme-rounded-lg', u.borderRadiusLg)
      root.style.setProperty('--theme-rounded-xl', u.borderRadiusXl)
      
      root.style.setProperty('--theme-padding-sm', u.paddingSm)
      root.style.setProperty('--theme-padding-md', u.paddingMd)
      root.style.setProperty('--theme-padding-lg', u.paddingLg)
      root.style.setProperty('--theme-padding-xl', u.paddingXl)
      
      root.style.setProperty('--theme-margin-sm', u.marginSm)
      root.style.setProperty('--theme-margin-md', u.marginMd)
      root.style.setProperty('--theme-margin-lg', u.marginLg)
      root.style.setProperty('--theme-margin-xl', u.marginXl)

      root.style.setProperty('--theme-sidebar-bg', u.sidebarBg)
      root.style.setProperty('--theme-popup-bg', u.popupBg)
      root.style.setProperty('--theme-accent', u.accent)
      root.style.setProperty('--theme-dim', u.dimText)
      root.style.setProperty('--theme-card-bg', u.cardBg)
      root.style.setProperty('--theme-accent-fg', u.accentFg || 'var(--theme-bg)')
    } else {
      // Fallback dynamic values based on color luminance
      let accent = t.blue || t.green || t.cyan
      if (currentTheme.id === 'tokyo-night') {
        accent = '#7aa2f7'
      } else if (currentTheme.id === 'mac-homebrew') {
        accent = '#28FE14'
      } else if (currentTheme.id === 'mac-novel') {
        accent = '#A05A00'
      }
      root.style.setProperty('--theme-accent', accent)

      const isLight = currentTheme.id.includes('novel') || (t.background.startsWith('#') && isColorLight(t.background))
      root.style.setProperty('--theme-sidebar-bg', isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.25)')
      root.style.setProperty('--theme-popup-bg', isLight ? '#f2eed9' : '#24283b')
      root.style.setProperty('--theme-dim', isLight ? '#73635A' : '#565f89')
      root.style.setProperty('--theme-card-bg', t.background)
      root.style.setProperty('--theme-font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif')
      root.style.setProperty('--theme-font-mono', '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace')
      root.style.setProperty('--theme-accent-fg', 'var(--theme-bg)')
    }
  }, [currentTheme, appSettings.darkMode])

  // Handle in-app zoom functionality (Ctrl + =, Ctrl + -, Ctrl + mouse wheel)
  useEffect(() => {
    const MIN_ZOOM = 0.5
    const MAX_ZOOM = 2.0
    const ZOOM_STEP = 0.1

    const getZoom = (): number => {
      if (window.omnitermAPI?.app?.getZoomFactor) {
        return window.omnitermAPI.app.getZoomFactor()
      }
      return 1.0
    }

    const setZoom = (factor: number) => {
      if (window.omnitermAPI?.app?.setZoomFactor) {
        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, factor))
        window.omnitermAPI.app.setZoomFactor(clamped)
      }
    }

    const s = appSettings.shortcuts || {
      zoomIn: 'Ctrl+=',
      zoomOut: 'Ctrl+-',
      newSession: 'Ctrl+N',
      newFolder: 'Ctrl+Shift+N',
      openSettings: 'Ctrl+,',
      toggleThemeMode: 'Ctrl+/',
      layout1: 'Ctrl+1',
      layout2: 'Ctrl+2',
      layout4: 'Ctrl+4',
      layout6: 'Ctrl+6',
      layout8: 'Ctrl+8',
      toggleSidebar: 'Ctrl+B',
      commandPalette: 'CommandOrControl+P',
      closeTab: 'Ctrl+W'
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      const isInput = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !active.closest('.xterm')

      if (matchShortcut(e, s.toggleThemeMode)) {
        e.preventDefault()
        setAppSettings({ ...appSettings, darkMode: !appSettings.darkMode })
        return
      }

      if (matchShortcut(e, s.zoomIn)) {
        e.preventDefault()
        setZoom(getZoom() + ZOOM_STEP)
        return
      }

      if (matchShortcut(e, s.zoomOut)) {
        e.preventDefault()
        setZoom(getZoom() - ZOOM_STEP)
        return
      }

      if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        setZoom(1.0)
        return
      }

      if (isInput) return

      if (matchShortcut(e, s.openSettings)) {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }

      if (matchShortcut(e, s.layout1)) {
        e.preventDefault()
        setLayoutMode(1)
        return
      }
      if (matchShortcut(e, s.layout2)) {
        e.preventDefault()
        setLayoutMode(2)
        return
      }
      if (matchShortcut(e, s.layout4)) {
        e.preventDefault()
        setLayoutMode(4)
        return
      }
      if (matchShortcut(e, s.layout6)) {
        e.preventDefault()
        setLayoutMode(6)
        return
      }
      if (matchShortcut(e, s.layout8)) {
        e.preventDefault()
        setLayoutMode(8)
        return
      }

      if (matchShortcut(e, s.toggleSidebar)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:toggle-sidebar'))
        return
      }

      if (matchShortcut(e, s.newSession)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:new-session'))
        return
      }

      if (matchShortcut(e, s.closeTab)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:close-tab'))
        return
      }

      if (matchShortcut(e, s.newFolder)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:new-folder'))
        return
      }

      if (matchShortcut(e, s.commandPalette)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:command-palette'))
        return
      }
    }

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (e.deltaY < 0) {
          // Scroll up: zoom in
          setZoom(getZoom() + ZOOM_STEP)
        } else if (e.deltaY > 0) {
          // Scroll down: zoom out
          setZoom(getZoom() - ZOOM_STEP)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('wheel', handleWheel)
    }
  }, [appSettings])

  // Non-null only when this renderer is a popped-out terminal window. Read synchronously — the
  // bridge derives it from the window label, so no await is needed before choosing a root view.
  const isDetachedWindow = (window.omnitermAPI?.terminalWindow?.detachedSessionId ?? null) !== null

  // Popped-out terminal window: render just the single-terminal view (the CSS-variable theme effect
  // above still runs, so it inherits the same look as the main window).
  if (isDetachedWindow) {
    return (
      <DetachedTerminalWindow
        currentTheme={currentTheme}
        darkMode={appSettings.darkMode}
        fontSize={appSettings.fontSize}
        smartColors={appSettings.smartColors}
      />
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--theme-bg)]">
      <TitleBar
        appSettings={appSettings}
        setAppSettings={(s) => setAppSettings(s)}
        themes={themes}
        onSettingsOpen={() => setSettingsOpen(true)}
        setThemeRemixOpen={setThemeRemixOpen}
        updateState={updateState}
      />
      <div className="flex-1 min-h-0 relative">
        <MainLayout
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          currentTheme={currentTheme}
          layoutMode={layoutMode}
          setLayoutMode={setLayoutMode}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          updateState={updateState}
          setUpdateState={setUpdateState}
        />
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
