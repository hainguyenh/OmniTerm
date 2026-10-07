// Global (no imports): merges into the AppSettings interface declared in vite-env.d.ts.

interface AppSettings {
  /** Custom editor hotkeys keyed by EditorShortcutBindings; validated by resolveEditorShortcuts. */
  editorShortcuts?: Record<string, string>
  /** Editor shortcut keys the user switched off; validated by resolveDisabledEditorShortcuts. */
  editorShortcutsDisabled?: string[]
}
