import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, shortcutLabels } from '../mainLayoutShared'

describe('MainLayout shortcut defaults', () => {
  it('provides a binding for every setting the UI renders', () => {
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual(Object.keys(shortcutLabels).sort())
  })

  it('includes the shortcuts added by the rebased settings schema', () => {
    expect(DEFAULT_SHORTCUTS.zoomReset).toBe('Ctrl+0')
    expect(DEFAULT_SHORTCUTS.layout3).toBe('Ctrl+3')
    expect(DEFAULT_SHORTCUTS.layout5).toBe('Ctrl+5')
    expect(DEFAULT_SHORTCUTS.layout7).toBe('Ctrl+7')
    expect(DEFAULT_SHORTCUTS.closeTab).toBe('Ctrl+W')
    expect(DEFAULT_SHORTCUTS.toggleAppFullscreen).toBe('F11')
  })
})
