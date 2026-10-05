import { EditorSelection, EditorState, type StateEffect, type Text } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'

import type { TextEol, TextFileContent } from '../../utils/textFileWire'
import { buildExtensions } from './editorExtensions'
import { LARGE_FILE_CHARS, LARGE_FILE_LINES, profileFor, type FileProfile } from './fileProfile'

/**
 * One tab's document, kept apart from any view — VS Code's model/view split.
 *
 * A tab owns this model for its whole life; an `EditorView` exists only while the tab is visible and
 * is rebuilt from `state` when it shows again. Undo history, selection and the parse tree all live in
 * the `EditorState`, so hiding and showing a tab loses nothing, while a hidden tab costs no DOM.
 */
export interface DocumentModel {
  state: EditorState | null
  view: EditorView | null
  /** Scroll position captured when the view was last destroyed, for the next one to restore. */
  scroll: StateEffect<unknown> | null
  hadFocus: boolean
  /** Cursor offset kept across an eviction, when `state` itself was dropped to save memory. */
  restoreHead: number | null
  /** Bumped whenever `state` is replaced wholesale (load, reload), so stale views and listeners
   *  from the previous document can tell they no longer own the model. */
  generation: number
  /** The document as last loaded or saved — the baseline for the dirty check. */
  savedDoc: Text | null
  profile: FileProfile
  /** Called after every document change, for previews that pull the text on their own schedule. */
  docListeners: Set<() => void>
}

export function createDocumentModel(): DocumentModel {
  return {
    state: null,
    view: null,
    scroll: null,
    hadFocus: false,
    restoreHead: null,
    generation: 0,
    savedDoc: null,
    profile: 'full',
    docListeners: new Set(),
  }
}

/** Build the editor state for freshly opened content. Line endings are left for CodeMirror to
 *  split (it accepts `\r\n`, `\r` and `\n` alike); `serialize` writes them back uniformly. */
export function createDocState(
  file: TextFileContent,
  onUpdate: (update: ViewUpdate) => void,
  restoreHead: number | null,
): { state: EditorState; profile: FileProfile } {
  const profile = profileFor({ chars: file.content.length, lines: file.lineCount, maxLineLen: file.maxLineLen })
  const head = restoreHead === null ? 0 : Math.min(Math.max(restoreHead, 0), file.content.length)
  const state = EditorState.create({
    doc: file.content,
    selection: EditorSelection.cursor(head),
    extensions: buildExtensions({ profile, readOnly: file.readOnly, onUpdate }),
  })
  return { state, profile }
}

/** The text to write to disk, every line ending normalized to the file's chosen one. */
export function serialize(doc: Text, eol: TextEol): string {
  return doc.sliceString(0, doc.length, eol === 'crlf' ? '\r\n' : '\n')
}

/**
 * Whether `doc` differs from the saved baseline, answered cheaply when possible: identity means
 * clean, a length difference means dirty. Only an equal-length document needs the full comparison,
 * which the caller may defer (`undefined` = "can't tell without comparing").
 */
export function quickDirty(doc: Text, saved: Text | null): boolean | undefined {
  if (!saved) return false
  if (doc === saved) return false
  if (doc.length !== saved.length) return true
  return undefined
}

/** A document that grew past the large-file limits while open is downgraded the same way a large
 *  file is on open; nothing ever upgrades mid-session, so features never flicker on and off. */
export function escalatedProfile(current: FileProfile, doc: Text): FileProfile {
  if (current === 'large') return current
  return doc.length > LARGE_FILE_CHARS || doc.lines > LARGE_FILE_LINES ? 'large' : current
}

/** The live state: the view's while one exists (it is ahead of `state` mid-transaction), else the
 *  stored one. */
export function currentState(model: DocumentModel): EditorState | null {
  return model.view?.state ?? model.state
}

/**
 * Apply effects to the model whether or not a view is mounted. The view is only dispatched to while it
 * still shows the model's state: right after a reload the old view lingers until React re-renders,
 * and an effect sent there would be applied to the discarded document.
 */
export function applyEffects(model: DocumentModel, effects: StateEffect<unknown>[]): void {
  if (model.view && model.view.state === model.state) {
    model.view.dispatch({ effects })
  } else if (model.state) {
    model.state = model.state.update({ effects }).state
  }
}
