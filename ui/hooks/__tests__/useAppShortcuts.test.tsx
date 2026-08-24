/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import { useAppShortcuts } from '../useAppShortcuts'
import { resolveShortcuts } from '../../utils/shortcuts'

const appSettings: AppSettings = {
  themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
}

/** Renders with a fresh set of spies, and focuses `target` (inside `.xterm` or not) first. */
function setup(target: 'xterm' | 'chrome', overrides: Partial<Parameters<typeof useAppShortcuts>[0]> = {}) {
  const changeFontSize = vi.fn()
  const resetFontSize = vi.fn()
  const persistZoom = vi.fn()
  const setAppSettings = vi.fn()
  const onToggleFullscreen = vi.fn()

  const host = document.createElement(target === 'xterm' ? 'div' : 'span')
  if (target === 'xterm') host.className = 'xterm'
  const focusable = document.createElement('button')
  host.appendChild(focusable)
  document.body.appendChild(host)
  focusable.focus()

  renderHook(() => useAppShortcuts({
    appSettings, setAppSettings, setSettingsOpen: vi.fn(),
    changeFontSize, resetFontSize, persistZoom, isDetached: false,
    onToggleFullscreen,
    ...overrides,
  }))

  return { changeFontSize, resetFontSize, persistZoom, setAppSettings, onToggleFullscreen, cleanup: () => host.remove() }
}

const ctrlKey = (key: string, extra: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra })

const plainKey = (key: string, extra: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })

describe('useAppShortcuts', () => {
  let setZoomFactor: ReturnType<typeof vi.fn>
  let getZoomFactor: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setZoomFactor = vi.fn()
    getZoomFactor = vi.fn(() => 1)
    mockOmnitermAPI({ app: { setZoomFactor, getZoomFactor } })
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('changes the terminal font size, not the app zoom, when focus is inside .xterm', () => {
    const { changeFontSize, cleanup } = setup('xterm')
    window.dispatchEvent(ctrlKey('='))
    expect(changeFontSize).toHaveBeenCalledWith(1)
    expect(setZoomFactor).not.toHaveBeenCalled()
    cleanup()
  })

  it('zooms the app chrome, not the terminal, when focus is outside .xterm', () => {
    const { changeFontSize, persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(ctrlKey('='))
    expect(changeFontSize).not.toHaveBeenCalled()
    expect(setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(persistZoom).toHaveBeenCalledWith(1.1)
    cleanup()
  })

  it('resets both the app zoom and the terminal font override on Ctrl+0', () => {
    const { resetFontSize, cleanup } = setup('chrome')
    window.dispatchEvent(ctrlKey('0'))
    expect(setZoomFactor).toHaveBeenCalledWith(1.0)
    expect(resetFontSize).toHaveBeenCalled()
    cleanup()
  })

  it('dispatches omniterm:change-layout for a layout hotkey instead of setting mode directly', () => {
    const { cleanup } = setup('chrome')
    const onLayout = vi.fn()
    window.addEventListener('omniterm:change-layout', onLayout)
    window.dispatchEvent(ctrlKey('3'))
    expect(onLayout).toHaveBeenCalledTimes(1)
    expect((onLayout.mock.calls[0][0] as CustomEvent).detail).toEqual({ mode: 3 })
    window.removeEventListener('omniterm:change-layout', onLayout)
    cleanup()
  })

  it('never dispatches a layout change from a detached window', () => {
    const changeFontSize = vi.fn()
    renderHook(() => useAppShortcuts({
      appSettings, setAppSettings: vi.fn(), setSettingsOpen: vi.fn(),
      changeFontSize, resetFontSize: vi.fn(), persistZoom: vi.fn(), isDetached: true,
      onToggleFullscreen: vi.fn(),
    }))
    const onLayout = vi.fn()
    window.addEventListener('omniterm:change-layout', onLayout)
    window.dispatchEvent(ctrlKey('3'))
    expect(onLayout).not.toHaveBeenCalled()
    window.removeEventListener('omniterm:change-layout', onLayout)
  })

  it('toggles app fullscreen on F11 even when a terminal has focus', () => {
    for (const target of ['xterm', 'chrome'] as const) {
      const { onToggleFullscreen, cleanup } = setup(target)
      window.dispatchEvent(plainKey('F11'))
      expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('skips the fullscreen toggle in a detached window', () => {
    const { onToggleFullscreen, cleanup } = setup('chrome', { isDetached: true })
    window.dispatchEvent(plainKey('F11'))
    expect(onToggleFullscreen).not.toHaveBeenCalled()
    cleanup()
  })

  it('honors a rebound fullscreen shortcut', () => {
    const rebound = { ...appSettings, shortcuts: { ...resolveShortcuts(appSettings.shortcuts), toggleAppFullscreen: 'F8' } }
    const { onToggleFullscreen, cleanup } = setup('chrome', { appSettings: rebound })
    window.dispatchEvent(plainKey('F11'))
    expect(onToggleFullscreen).not.toHaveBeenCalled()
    window.dispatchEvent(plainKey('F8'))
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('still toggles app fullscreen when a plain input outside xterm has focus — F-keys are not text entry', () => {
    const onToggleFullscreen = vi.fn()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useAppShortcuts({
      appSettings, setAppSettings: vi.fn(), setSettingsOpen: vi.fn(),
      changeFontSize: vi.fn(), resetFontSize: vi.fn(), persistZoom: vi.fn(),
      isDetached: false, onToggleFullscreen,
    }))
    window.dispatchEvent(plainKey('F11'))
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('toggles dark mode on Ctrl+/', () => {
    const setAppSettings = vi.fn()
    const { cleanup } = (() => {
      const host = document.createElement('span')
      const btn = document.createElement('button')
      host.appendChild(btn)
      document.body.appendChild(host)
      btn.focus()
      renderHook(() => useAppShortcuts({
        appSettings, setAppSettings, setSettingsOpen: vi.fn(),
        changeFontSize: vi.fn(), resetFontSize: vi.fn(), persistZoom: vi.fn(),
        isDetached: false, onToggleFullscreen: vi.fn(),
      }))
      return { cleanup: () => host.remove() }
    })()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(setAppSettings).toHaveBeenCalledWith({ ...appSettings, darkMode: false })
    cleanup()
  })
  it('zooms out inside terminal via changeFontSize', () => {
    const { changeFontSize, cleanup } = setup('xterm')
    window.dispatchEvent(ctrlKey('-'))
    expect(changeFontSize).toHaveBeenCalledWith(-1)
    cleanup()
  })

  it('zooms chrome out on Ctrl+-', () => {
    const { persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(ctrlKey('-'))
    expect(setZoomFactor).toHaveBeenCalledWith(0.9)
    expect(persistZoom).toHaveBeenCalledWith(0.9)
    cleanup()
  })

  it('ignores shortcuts when an input is focused outside xterm', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useAppShortcuts({
      appSettings, setAppSettings: vi.fn(), setSettingsOpen: vi.fn(),
      changeFontSize: vi.fn(), resetFontSize: vi.fn(), persistZoom: vi.fn(),
      isDetached: false, onToggleFullscreen: vi.fn(),
    }))
    const onSession = vi.fn()
    window.addEventListener('omniterm:new-session', onSession)
    window.dispatchEvent(ctrlKey('N'))
    expect(onSession).not.toHaveBeenCalled()
    window.removeEventListener('omniterm:new-session', onSession)
    input.remove()
  })

  it('opens settings on Ctrl+,', () => {
    const setSettingsOpen = vi.fn()
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.focus()
    renderHook(() => useAppShortcuts({
      appSettings, setAppSettings: vi.fn(), setSettingsOpen,
      changeFontSize: vi.fn(), resetFontSize: vi.fn(), persistZoom: vi.fn(),
      isDetached: false, onToggleFullscreen: vi.fn(),
    }))
    window.dispatchEvent(ctrlKey(','))
    expect(setSettingsOpen).toHaveBeenCalledWith(true)
    btn.remove()
  })

  it('dispatches omniterm:toggle-sidebar on Ctrl+B', () => {
    const { cleanup } = setup('chrome')
    const onSidebar = vi.fn()
    window.addEventListener('omniterm:toggle-sidebar', onSidebar)
    window.dispatchEvent(ctrlKey('b'))
    expect(onSidebar).toHaveBeenCalled()
    window.removeEventListener('omniterm:toggle-sidebar', onSidebar)
    cleanup()
  })

  it('dispatches omniterm:new-session on Ctrl+N', () => {
    const { cleanup } = setup('chrome')
    const onNew = vi.fn()
    window.addEventListener('omniterm:new-session', onNew)
    window.dispatchEvent(ctrlKey('n'))
    expect(onNew).toHaveBeenCalled()
    window.removeEventListener('omniterm:new-session', onNew)
    cleanup()
  })

  it('dispatches omniterm:close-tab on Ctrl+W', () => {
    const { cleanup } = setup('chrome')
    const onClose = vi.fn()
    window.addEventListener('omniterm:close-tab', onClose)
    window.dispatchEvent(ctrlKey('w'))
    expect(onClose).toHaveBeenCalled()
    window.removeEventListener('omniterm:close-tab', onClose)
    cleanup()
  })

  it('dispatches omniterm:new-folder on Ctrl+Shift+N', () => {
    const { cleanup } = setup('chrome')
    const onFolder = vi.fn()
    window.addEventListener('omniterm:new-folder', onFolder)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(onFolder).toHaveBeenCalled()
    window.removeEventListener('omniterm:new-folder', onFolder)
    cleanup()
  })

  it('dispatches omniterm:command-palette on Ctrl+P', () => {
    const { cleanup } = setup('chrome')
    const onPalette = vi.fn()
    window.addEventListener('omniterm:command-palette', onPalette)
    window.dispatchEvent(ctrlKey('p'))
    expect(onPalette).toHaveBeenCalled()
    window.removeEventListener('omniterm:command-palette', onPalette)
    cleanup()
  })

  it('Ctrl+wheel up zooms in', () => {
    const { persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, ctrlKey: true, cancelable: true }))
    expect(setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(persistZoom).toHaveBeenCalledWith(1.1)
    cleanup()
  })

  it('Ctrl+wheel down zooms out', () => {
    const { persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, ctrlKey: true, cancelable: true }))
    expect(setZoomFactor).toHaveBeenCalledWith(0.9)
    expect(persistZoom).toHaveBeenCalledWith(0.9)
    cleanup()
  })

  it('wheel without Ctrl is ignored', () => {
    const { persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, cancelable: true }))
    expect(setZoomFactor).not.toHaveBeenCalled()
    expect(persistZoom).not.toHaveBeenCalled()
    cleanup()
  })

  it('clamps zoom to MIN_ZOOM (0.5)', () => {
    const { persistZoom, cleanup } = setup('chrome')
    getZoomFactor.mockReturnValue(0.5)
    window.dispatchEvent(ctrlKey('-'))
    expect(setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(persistZoom).toHaveBeenCalledWith(0.5)
    cleanup()
  })

  it('clamps zoom to MAX_ZOOM (2.0)', () => {
    const { persistZoom, cleanup } = setup('chrome')
    getZoomFactor.mockReturnValue(2.0)
    window.dispatchEvent(ctrlKey('='))
    expect(setZoomFactor).toHaveBeenCalledWith(2.0)
    expect(persistZoom).toHaveBeenCalledWith(2.0)
    cleanup()
  })

  it('ignores wheel without Ctrl/meta key', () => {
    const { persistZoom, cleanup } = setup('chrome')
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, cancelable: true }))
    expect(setZoomFactor).not.toHaveBeenCalled()
    expect(persistZoom).not.toHaveBeenCalled()
    cleanup()
  })

  // A focused terminal must win back the shell/agent's own bare-Ctrl control keys — previously only
  // the zoom trio checked terminal focus, so Ctrl+W closed the tab instead of running a shell's
  // delete-word, Ctrl+B toggled the sidebar instead of reaching a TUI, and so on.
  describe('a focused terminal keeps its shell/agent control keys', () => {
    it.each([
      ['close-tab', 'w', 'omniterm:close-tab'],
      ['toggle-sidebar', 'b', 'omniterm:toggle-sidebar'],
      ['new-session', 'n', 'omniterm:new-session'],
      ['command-palette', 'p', 'omniterm:command-palette'],
    ] as const)('does not dispatch omniterm:%s on Ctrl+%s', (_label, letter, eventName) => {
      const { cleanup } = setup('xterm')
      const onEvent = vi.fn()
      window.addEventListener(eventName, onEvent)
      window.dispatchEvent(ctrlKey(letter))
      expect(onEvent).not.toHaveBeenCalled()
      window.removeEventListener(eventName, onEvent)
      cleanup()
    })

    it('does not toggle dark mode on Ctrl+/', () => {
      const setAppSettings = vi.fn()
      const host = document.createElement('div')
      host.className = 'xterm'
      const btn = document.createElement('button')
      host.appendChild(btn)
      document.body.appendChild(host)
      btn.focus()
      renderHook(() => useAppShortcuts({
        appSettings, setAppSettings, setSettingsOpen: vi.fn(),
        changeFontSize: vi.fn(), resetFontSize: vi.fn(), persistZoom: vi.fn(),
        isDetached: false, onToggleFullscreen: vi.fn(),
      }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }))
      expect(setAppSettings).not.toHaveBeenCalled()
      host.remove()
    })

    it('still zooms the terminal on Ctrl+= / Ctrl+- / Ctrl+0', () => {
      const { changeFontSize, resetFontSize, cleanup } = setup('xterm')
      window.dispatchEvent(ctrlKey('='))
      expect(changeFontSize).toHaveBeenCalledWith(1)
      window.dispatchEvent(ctrlKey('0'))
      expect(resetFontSize).toHaveBeenCalled()
      cleanup()
    })

    it('still creates a new folder on Ctrl+Shift+N — Shift means it cannot collide with a shell default', () => {
      const { cleanup } = setup('xterm')
      const onFolder = vi.fn()
      window.addEventListener('omniterm:new-folder', onFolder)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
      expect(onFolder).toHaveBeenCalled()
      window.removeEventListener('omniterm:new-folder', onFolder)
      cleanup()
    })
  })
})
