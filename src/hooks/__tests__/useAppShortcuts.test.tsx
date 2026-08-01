/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import { useAppShortcuts } from '../useAppShortcuts'

const appSettings: AppSettings = {
  themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
}

/** Renders with a fresh set of spies, and focuses `target` (inside `.xterm` or not) first. */
function setup(target: 'xterm' | 'chrome') {
  const changeFontSize = vi.fn()
  const resetFontSize = vi.fn()
  const persistZoom = vi.fn()
  const setAppSettings = vi.fn()

  const host = document.createElement(target === 'xterm' ? 'div' : 'span')
  if (target === 'xterm') host.className = 'xterm'
  const focusable = document.createElement('button')
  host.appendChild(focusable)
  document.body.appendChild(host)
  focusable.focus()

  renderHook(() => useAppShortcuts({
    appSettings, setAppSettings, setSettingsOpen: vi.fn(),
    changeFontSize, resetFontSize, persistZoom, isDetached: false,
  }))

  return { changeFontSize, resetFontSize, persistZoom, setAppSettings, cleanup: () => host.remove() }
}

const ctrlKey = (key: string, extra: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra })

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
    }))
    const onLayout = vi.fn()
    window.addEventListener('omniterm:change-layout', onLayout)
    window.dispatchEvent(ctrlKey('3'))
    expect(onLayout).not.toHaveBeenCalled()
    window.removeEventListener('omniterm:change-layout', onLayout)
  })
})
