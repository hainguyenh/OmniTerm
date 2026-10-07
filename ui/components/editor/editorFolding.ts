import { foldAll, foldCode, foldEffect, foldable, unfoldAll, unfoldCode } from '@codemirror/language'
import type { EditorView, KeyBinding } from '@codemirror/view'

import {
  type EditorShortcutBindings,
  resolveEditorShortcuts,
  toCodeMirrorKey,
} from './editorShortcuts'
import { gateEditorCommand } from './editorShortcutGate'

/**
 * Folds all foldable syntax blocks at the specified nesting depth.
 * Level 1 represents outermost blocks (functions, classes, root-level blocks).
 */
export function foldLevel(view: EditorView, targetLevel: number): boolean {
  if (targetLevel < 1) return false
  const { state } = view
  const effects = []
  const stack: { from: number; to: number }[] = []

  for (let pos = 0; pos < state.doc.length;) {
    const line = view.lineBlockAt(pos)
    const range = foldable(state, line.from, line.to)
    if (range) {
      while (stack.length > 0 && stack[stack.length - 1].to <= range.from) {
        stack.pop()
      }
      stack.push(range)
      const currentLevel = stack.length
      if (currentLevel === targetLevel) {
        effects.push(foldEffect.of(range))
      }
    }
    pos = (range ? view.lineBlockAt(range.to) : line).to + 1
  }

  if (effects.length > 0) {
    view.dispatch({ effects })
    return true
  }
  return false
}

/** Builds CodeMirror KeyBindings for folding actions configured by user or defaults. */
export function createEditorFoldKeymap(
  customShortcuts?: Partial<EditorShortcutBindings> | Record<string, string>,
): KeyBinding[] {
  const s = resolveEditorShortcuts(customShortcuts)
  const bindings: KeyBinding[] = []

  // Every binding is gated by its settings key, so switching a shortcut off lets the key fall through.
  const add = (key: keyof EditorShortcutBindings, run: (v: EditorView) => boolean) => {
    const cmKey = toCodeMirrorKey(s[key])
    if (cmKey) {
      bindings.push({ key: cmKey, run: gateEditorCommand(key, run) })
    }
  }

  add('foldAll', foldAll)
  add('unfoldAll', unfoldAll)
  if (s.unfoldAll === 'Ctrl+Shift+=') {
    bindings.push({ key: 'Mod-Shift-+', run: gateEditorCommand('unfoldAll', unfoldAll) })
  }
  add('foldCurrent', foldCode)
  add('unfoldCurrent', unfoldCode)
  if (s.unfoldCurrent === 'Ctrl+=') {
    bindings.push({ key: 'Mod-+', run: gateEditorCommand('unfoldCurrent', unfoldCode) })
  }
  add('foldLevel1', (v) => foldLevel(v, 1))
  add('foldLevel2', (v) => foldLevel(v, 2))
  add('foldLevel3', (v) => foldLevel(v, 3))
  add('foldLevel4', (v) => foldLevel(v, 4))
  add('foldLevel5', (v) => foldLevel(v, 5))

  return bindings
}

/** Default JetBrains-style folding keyboard shortcuts. */
export const jetbrainsFoldKeymap: KeyBinding[] = createEditorFoldKeymap()

export { foldAll, unfoldAll, foldCode, unfoldCode }
