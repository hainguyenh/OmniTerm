import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection, type ViewUpdate, EditorView,
} from '@codemirror/view'

import { editorTheme } from './editorTheme'
import type { FileProfile } from './fileProfile'
import { renderFoldMarker, renderFoldPlaceholder } from './editorControls'
import { createEditorFoldKeymap, jetbrainsFoldKeymap } from './editorFolding'
import { eslintRuler } from './editorRuler'
import { gateEditorCommand } from './editorShortcutGate'

/**
 * The editor's extension set. Deliberately no autocompletion, bracket auto-closing or lint: this is
 * a fast viewer/editor, not an IDE. Everything that costs a walk over the document (folding, bracket
 * matching, selection-match highlighting) lives in the `full` profile only.
 *
 * Compartments hold what can change after the document is open — the grammar arrives asynchronously,
 * the profile can escalate as the document grows, and the read-only flag follows the file on disk.
 */
export const languageSlot = new Compartment()
export const profileSlot = new Compartment()
export const readOnlySlot = new Compartment()

/** CodeMirror's search keys with Find (Mod-f) gated by the user's "Search in File" toggle. */
const gatedSearchKeymap = searchKeymap.map((binding) =>
  binding.key === 'Mod-f' ? { ...binding, run: gateEditorCommand('searchFile', openSearchPanel) } : binding,
)

export function profileExtensions(profile: FileProfile): Extension {
  if (profile !== 'full') return []
  return [
    foldGutter({ markerDOM: renderFoldMarker }),
    codeFolding({ placeholderDOM: (_view, onClick) => renderFoldPlaceholder(onClick) }),
    bracketMatching(),
    highlightSelectionMatches(),
    highlightActiveLine(),
    indentOnInput(),
  ]
}

export interface ExtensionOptions {
  profile: FileProfile
  readOnly: boolean
  onUpdate: (update: ViewUpdate) => void
  editorShortcuts?: Record<string, string>
}

export function buildExtensions({ profile, readOnly, onUpdate, editorShortcuts }: ExtensionOptions): Extension[] {
  const foldBindings = editorShortcuts ? createEditorFoldKeymap(editorShortcuts) : jetbrainsFoldKeymap
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...gatedSearchKeymap, ...historyKeymap, ...foldKeymap, ...foldBindings, indentWithTab]),
    editorTheme,
    eslintRuler(),
    languageSlot.of([]),
    profileSlot.of(profileExtensions(profile)),
    readOnlySlot.of(EditorState.readOnly.of(readOnly)),
    EditorView.updateListener.of(onUpdate),
  ]
}
