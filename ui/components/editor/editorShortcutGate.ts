import type { Command } from '@codemirror/view'

import type { EditorShortcutBindings } from './editorShortcuts'

/**
 * Which editor shortcuts the user switched off, read by CodeMirror keymaps at key time.
 *
 * Editor states are built once per document and outlive any settings change, so the keymaps cannot
 * capture the setting when they are created. Checking this module-level set on every keypress makes
 * a toggle take effect immediately in every open editor without rebuilding its state.
 */
let disabledShortcuts: ReadonlySet<keyof EditorShortcutBindings> = new Set()

export function setDisabledEditorShortcuts(keys: ReadonlySet<keyof EditorShortcutBindings>): void {
  disabledShortcuts = keys
}

export function isEditorShortcutEnabled(key: keyof EditorShortcutBindings): boolean {
  return !disabledShortcuts.has(key)
}

/** A disabled shortcut's command reports "not handled", so the key falls through as if unbound. */
export function gateEditorCommand(key: keyof EditorShortcutBindings, run: Command): Command {
  return (view) => isEditorShortcutEnabled(key) && run(view)
}
