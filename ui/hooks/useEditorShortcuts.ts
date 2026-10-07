import { useEffect, useMemo } from 'react'

import { setDisabledEditorShortcuts } from '../components/editor/editorShortcutGate'
import {
  DOUBLE_SHIFT,
  resolveDisabledEditorShortcuts,
  resolveEditorShortcuts,
} from '../components/editor/editorShortcuts'
import { matchShortcut } from '../utils/keyboard'
import { createDoubleShiftDetector } from './doubleShift'

export interface UseEditorShortcutsInput {
  appSettings: AppSettings
  /** True only while the focused pane shows an editor tab. */
  editorActive: boolean
}

const openSearchEverywhere = () => {
  window.dispatchEvent(new CustomEvent('omniterm:search-everywhere'))
}

/**
 * Applies the Editor Shortcuts settings: publishes the switched-off set to the CodeMirror keymaps,
 * and owns the global "Search Everywhere" hotkey. That hotkey listens only while an editor tab is
 * active and the user has it enabled, so Shift in a terminal or the chrome never opens the search.
 */
export function useEditorShortcuts({ appSettings, editorActive }: UseEditorShortcutsInput): void {
  const disabled = useMemo(
    () => resolveDisabledEditorShortcuts(appSettings.editorShortcutsDisabled),
    [appSettings.editorShortcutsDisabled],
  )
  const searchBinding = resolveEditorShortcuts(appSettings.editorShortcuts).searchGlobal
  const searchActive = editorActive && !disabled.has('searchGlobal') && searchBinding !== 'None'

  useEffect(() => {
    setDisabledEditorShortcuts(disabled)
  }, [disabled])

  useEffect(() => {
    if (!searchActive) return

    if (searchBinding !== DOUBLE_SHIFT) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!matchShortcut(e, searchBinding)) return
        e.preventDefault()
        openSearchEverywhere()
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }

    const detector = createDoubleShiftDetector(openSearchEverywhere)
    // Capture phase: CodeMirror and xterm stop some key events from bubbling to the window.
    window.addEventListener('keydown', detector.keydown, true)
    window.addEventListener('keyup', detector.keyup, true)
    window.addEventListener('pointerdown', detector.reset, true)
    window.addEventListener('blur', detector.reset)
    return () => {
      window.removeEventListener('keydown', detector.keydown, true)
      window.removeEventListener('keyup', detector.keyup, true)
      window.removeEventListener('pointerdown', detector.reset, true)
      window.removeEventListener('blur', detector.reset)
    }
  }, [searchActive, searchBinding])
}
