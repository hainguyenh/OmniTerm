export interface EditorShortcutBindings {
  foldLevel1: string
  foldLevel2: string
  foldLevel3: string
  foldLevel4: string
  foldLevel5: string
  foldAll: string
  unfoldAll: string
  foldCurrent: string
  unfoldCurrent: string
  searchGlobal: string
  searchFile: string
}

export const DEFAULT_EDITOR_SHORTCUTS: EditorShortcutBindings = {
  foldLevel1: 'Ctrl+Shift+1',
  foldLevel2: 'Ctrl+Shift+2',
  foldLevel3: 'Ctrl+Shift+3',
  foldLevel4: 'Ctrl+Shift+4',
  foldLevel5: 'Ctrl+Shift+5',
  foldAll: 'Ctrl+Shift+-',
  unfoldAll: 'Ctrl+Shift+=',
  foldCurrent: 'Ctrl+-',
  unfoldCurrent: 'Ctrl+=',
  searchGlobal: 'Shift+Shift',
  searchFile: 'Ctrl+F',
}

export const editorShortcutLabels: Record<keyof EditorShortcutBindings, string> = {
  foldLevel1: 'Fold Level 1',
  foldLevel2: 'Fold Level 2',
  foldLevel3: 'Fold Level 3',
  foldLevel4: 'Fold Level 4',
  foldLevel5: 'Fold Level 5',
  foldAll: 'Fold All (Collapse All)',
  unfoldAll: 'Unfold All (Expand All)',
  foldCurrent: 'Fold Current Block',
  unfoldCurrent: 'Unfold Current Block',
  searchGlobal: 'Search Global (Search Everywhere)',
  searchFile: 'Search in File (Find)',
}

export const EDITOR_SHORTCUT_DESCRIPTIONS: Record<keyof EditorShortcutBindings, string> = {
  foldLevel1: 'Collapse outermost code blocks (depth 1: functions, classes, root blocks)',
  foldLevel2: 'Collapse code blocks nested 2 levels deep',
  foldLevel3: 'Collapse code blocks nested 3 levels deep',
  foldLevel4: 'Collapse code blocks nested 4 levels deep',
  foldLevel5: 'Collapse code blocks nested 5 levels deep',
  foldAll: 'Collapse all foldable regions in the active editor',
  unfoldAll: 'Expand all collapsed regions in the active editor',
  foldCurrent: 'Collapse the code block enclosing the cursor',
  unfoldCurrent: 'Expand the code block enclosing the cursor',
  searchGlobal: 'Search across all project files in the workspace while an editor tab is active',
  searchFile: 'Open the in-file search and replace panel',
}

export const FOLD_SHORTCUT_KEYS: Array<keyof EditorShortcutBindings> = [
  'foldLevel1',
  'foldLevel2',
  'foldLevel3',
  'foldLevel4',
  'foldLevel5',
  'foldAll',
  'unfoldAll',
  'foldCurrent',
  'unfoldCurrent',
]

export const NAV_SHORTCUT_KEYS: Array<keyof EditorShortcutBindings> = [
  'searchGlobal',
  'searchFile',
]

/** The JetBrains-style tap-Shift-twice binding; it has no CodeMirror keymap form. */
export const DOUBLE_SHIFT = 'Shift+Shift'

const EDITOR_SHORTCUT_KEYS = Object.keys(DEFAULT_EDITOR_SHORTCUTS) as Array<keyof EditorShortcutBindings>

function isEditorShortcutKey(value: unknown): value is keyof EditorShortcutBindings {
  return EDITOR_SHORTCUT_KEYS.some((key) => key === value)
}

/**
 * The persisted list of switched-off editor shortcuts, narrowed to known keys. A stale or hand-edited
 * entry is dropped rather than trusted, so a renamed shortcut can never stay silently disabled.
 */
export function resolveDisabledEditorShortcuts(saved: unknown): ReadonlySet<keyof EditorShortcutBindings> {
  if (!Array.isArray(saved)) return new Set()
  return new Set(saved.filter(isEditorShortcutKey))
}

/** Normalizes user shortcut strings like "Ctrl+Shift+1" into CodeMirror keymap format "Ctrl-Shift-1". */
export function toCodeMirrorKey(combo: string): string {
  if (!combo || combo === 'None' || combo === DOUBLE_SHIFT) return ''
  return combo
    .split('+')
    .map((part) => {
      const p = part.trim()
      if (p.toLowerCase() === 'ctrl') return 'Mod'
      return p
    })
    .join('-')
}

export function resolveEditorShortcuts(
  saved?: Partial<EditorShortcutBindings> | Record<string, string>,
): EditorShortcutBindings {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_EDITOR_SHORTCUTS }
  return {
    ...DEFAULT_EDITOR_SHORTCUTS,
    ...saved,
  }
}
