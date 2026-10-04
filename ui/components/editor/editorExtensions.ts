import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection, type ViewUpdate, EditorView,
} from '@codemirror/view'

import { editorTheme } from './editorTheme'
import type { FileProfile } from './fileProfile'
import { renderFoldMarker, renderFoldPlaceholder } from './editorControls'

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
}

export function buildExtensions({ profile, readOnly, onUpdate }: ExtensionOptions): Extension[] {
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
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    editorTheme,
    languageSlot.of([]),
    profileSlot.of(profileExtensions(profile)),
    readOnlySlot.of(EditorState.readOnly.of(readOnly)),
    EditorView.updateListener.of(onUpdate),
  ]
}
