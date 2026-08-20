import { useEffect } from 'react'
import { matchShortcut } from '../utils/keyboard'
import { resolveShortcuts, survivesTerminalFocus } from '../utils/shortcuts'

const LAYOUT_KEYS = ['layout1', 'layout2', 'layout3', 'layout4', 'layout5', 'layout6', 'layout7', 'layout8'] as const

export interface UseAppShortcutsInput {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  setSettingsOpen: (open: boolean) => void
  /** Shift the focused terminal's font size (or the app-wide default with none focused). */
  changeFontSize: (delta: number) => void
  /** Clear the focused terminal's font-size override, falling back to its connection/app default. */
  resetFontSize: () => void
  /** Persist the app-wide zoom factor after a change, so it survives restart. */
  persistZoom: (factor: number) => void
  /** True in a popped-out terminal window, which has no layout to switch. */
  isDetached: boolean
}

/**
 * The app's global keyboard + Ctrl-wheel shortcuts: zoom, layout switching, and the various
 * `omniterm:*` command events. Extracted out of App.tsx, which has near no headroom under its
 * line-limit baseline.
 *
 * Zoom is scoped by where the input landed: over a terminal, Ctrl+=/-/wheel change that terminal's
 * font size (xterm already owns that in TerminalView.tsx); everywhere else they zoom the app chrome.
 * A terminal's own wheel handler stops propagation, so this hook only ever sees chrome-scoped wheel
 * events — but the keyboard path has no such gate, hence the explicit `inTerminal` branch below.
 */
export function useAppShortcuts({
  appSettings, setAppSettings, setSettingsOpen, changeFontSize, resetFontSize, persistZoom, isDetached,
}: UseAppShortcutsInput) {
  useEffect(() => {
    const MIN_ZOOM = 0.5
    const MAX_ZOOM = 2.0
    const ZOOM_STEP = 0.1

    const getZoom = (): number => window.omnitermAPI?.app?.getZoomFactor?.() ?? 1.0
    const setZoom = (factor: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, factor))
      window.omnitermAPI?.app?.setZoomFactor?.(clamped)
      persistZoom(clamped)
    }

    const s = resolveShortcuts(appSettings.shortcuts)

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      const inTerminal = active instanceof Element && !!active.closest('.xterm')
      const isInput = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !inTerminal

      // A focused terminal wins the shell/agent's own control keys (Ctrl+W, Ctrl+B, Ctrl+N, Ctrl+P,
      // Ctrl+/, Ctrl+,, …) back from the app chrome — only the zoom trio and any Ctrl+Shift/Alt combo
      // (which never collides with a bare-Ctrl shell default) still fire while a pane has focus.
      const matches = (key: keyof ShortcutBindings): boolean =>
        matchShortcut(e, s[key]) && (!inTerminal || survivesTerminalFocus(key, s[key]))

      if (matches('toggleThemeMode')) {
        e.preventDefault()
        setAppSettings({ ...appSettings, darkMode: !appSettings.darkMode })
        return
      }

      if (matches('zoomIn')) {
        e.preventDefault()
        if (inTerminal) changeFontSize(1)
        else setZoom(getZoom() + ZOOM_STEP)
        return
      }

      if (matches('zoomOut')) {
        e.preventDefault()
        if (inTerminal) changeFontSize(-1)
        else setZoom(getZoom() - ZOOM_STEP)
        return
      }

      if (matches('zoomReset')) {
        e.preventDefault()
        setZoom(1.0)
        resetFontSize()
        return
      }

      if (isInput) return

      if (matches('openSettings')) {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }

      // Routed through the `omniterm:change-layout` event (MainLayout's `changeLayoutMode`) rather
      // than a direct `setLayoutMode`, so a hotkey gets the same focused-pane rescue, pane auto-fill,
      // and persisted mode that the layout picker's buttons already do. A detached window has no
      // layout to switch — the event would be silently meaningless there.
      if (!isDetached) {
        for (const key of LAYOUT_KEYS) {
          if (matches(key)) {
            e.preventDefault()
            window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode: Number(key.slice(6)) } }))
            return
          }
        }
      }

      if (matches('toggleSidebar')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:toggle-sidebar'))
        return
      }

      if (matches('newSession')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:new-session'))
        return
      }

      if (matches('closeTab')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:close-tab'))
        return
      }

      if (matches('newFolder')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:new-folder'))
        return
      }

      if (matches('commandPalette')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:command-palette'))
        return
      }
    }

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (e.deltaY < 0) setZoom(getZoom() + ZOOM_STEP)
      else if (e.deltaY > 0) setZoom(getZoom() - ZOOM_STEP)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('wheel', handleWheel)
    }
  }, [appSettings, setAppSettings, setSettingsOpen, changeFontSize, resetFontSize, persistZoom, isDetached])
}
