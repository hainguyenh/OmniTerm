/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isEditorShortcutEnabled, setDisabledEditorShortcuts } from '../../components/editor/editorShortcutGate'
import { useEditorShortcuts, type UseEditorShortcutsInput } from '../useEditorShortcuts'

const baseSettings: AppSettings = {
  themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
}

const fire = (type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init }))

const tapShift = () => {
  fire('keydown', 'Shift', { shiftKey: true })
  fire('keyup', 'Shift')
}

describe('useEditorShortcuts', () => {
  const onSearch = vi.fn()

  beforeEach(() => {
    onSearch.mockReset()
    window.addEventListener('omniterm:search-everywhere', onSearch)
  })
  afterEach(() => {
    window.removeEventListener('omniterm:search-everywhere', onSearch)
    setDisabledEditorShortcuts(new Set())
  })

  const render = (input: Partial<UseEditorShortcutsInput> = {}) =>
    renderHook((props: UseEditorShortcutsInput) => useEditorShortcuts(props), {
      initialProps: { appSettings: baseSettings, editorActive: true, ...input },
    })

  it('opens Search Everywhere on a double Shift tap while an editor tab is active', () => {
    render()
    tapShift()
    tapShift()
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  // Regression: Shift alone used to open Search Everywhere from anywhere in the app.
  it('ignores Shift when no editor tab is active', () => {
    render({ editorActive: false })
    tapShift()
    tapShift()
    expect(onSearch).not.toHaveBeenCalled()
  })

  // Regression: holding Shift fired auto-repeat keydowns that read as a double tap.
  it('ignores a held Shift key', () => {
    render()
    fire('keydown', 'Shift', { shiftKey: true })
    fire('keydown', 'Shift', { shiftKey: true, repeat: true })
    fire('keydown', 'Shift', { shiftKey: true, repeat: true })
    fire('keyup', 'Shift')
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('stops listening once the editor tab is no longer active', () => {
    const { rerender } = render()
    rerender({ appSettings: baseSettings, editorActive: false })
    tapShift()
    tapShift()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('does nothing when the user switched Search Global off', () => {
    render({ appSettings: { ...baseSettings, editorShortcutsDisabled: ['searchGlobal'] } })
    tapShift()
    tapShift()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('uses a custom Search Global binding instead of double Shift', () => {
    render({ appSettings: { ...baseSettings, editorShortcuts: { searchGlobal: 'Ctrl+Shift+F' } } })
    tapShift()
    tapShift()
    expect(onSearch).not.toHaveBeenCalled()
    fire('keydown', 'f', { ctrlKey: true, shiftKey: true })
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('ignores a custom Search Global binding when no editor tab is active', () => {
    render({
      appSettings: { ...baseSettings, editorShortcuts: { searchGlobal: 'Ctrl+Shift+F' } },
      editorActive: false,
    })
    fire('keydown', 'f', { ctrlKey: true, shiftKey: true })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('publishes the switched-off shortcuts to the editor keymap gate', () => {
    const { rerender } = render({ appSettings: { ...baseSettings, editorShortcutsDisabled: ['searchFile', 'bogus'] } })
    expect(isEditorShortcutEnabled('searchFile')).toBe(false)
    expect(isEditorShortcutEnabled('foldAll')).toBe(true)
    rerender({ appSettings: baseSettings, editorActive: true })
    expect(isEditorShortcutEnabled('searchFile')).toBe(true)
  })
})
