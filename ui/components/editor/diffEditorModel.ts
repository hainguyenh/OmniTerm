import type { DiffConfig } from '@codemirror/merge'
import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type { TextEol } from '../../utils/textFileWire'
import { quickDirty } from './documentModel'
import { languageSlot } from './editorExtensions'
import { profileFor, type DocumentShape, type FileProfile } from './fileProfile'
import { loadLanguage, resolveLanguageId } from './languageLoader'

/**
 * Shared pieces for editors that are embedded in other views (the git diff and conflict editors)
 * rather than owned by a file tab. They use the same extensions, theme, grammars and large-file
 * profile as the file editor; what differs is that the text comes from git and is saved by the host.
 */

/** What a host needs from an embedded editor: the text to write, and a way to mark it saved. */
export interface TextEditorHandle {
  getText: () => string
  markSaved: () => void
  /** Diff editors only: scroll to the next (1) or previous (-1) change, wrapping at either end. */
  goToChange?: (direction: 1 | -1) => void
}

/** Which change the cursor is on (`index` -1 when between changes) out of how many. */
export interface ChangePosition {
  index: number
  count: number
}

/** A changed stretch of the editable side, as document offsets. */
export interface ChangeSpan {
  from: number
  to: number
}

/**
 * The change to jump to from the cursor at `head`: the first one starting after it going forward,
 * the last one starting before it going back, wrapping around at either end.
 */
export function nextChangeIndex(changes: readonly ChangeSpan[], head: number, direction: 1 | -1): number {
  if (direction > 0) {
    const index = changes.findIndex((change) => change.from > head)
    return index === -1 ? 0 : index
  }
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    if (changes[index].from < head) return index
  }
  return changes.length - 1
}

/** The change holding the cursor, or -1 when it sits between changes. */
export function changeIndexAt(changes: readonly ChangeSpan[], head: number): number {
  return changes.findIndex((change) => change.from <= head && head <= change.to)
}

/** Equal-length edits are compared in full only after typing pauses, as in the file editor. */
const EQ_CHECK_DELAY_MS = 150

/** The line ending to write back: CRLF only when the loaded text used it. */
export function detectEol(text: string): TextEol {
  return text.includes('\r\n') ? 'crlf' : 'lf'
}

/** Character, line and longest-line counts in one pass, without splitting the string. */
export function measureText(text: string): DocumentShape {
  let lines = 1
  let maxLineLen = 0
  let lineStart = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    maxLineLen = Math.max(maxLineLen, index - lineStart)
    lineStart = index + 1
    lines += 1
  }
  maxLineLen = Math.max(maxLineLen, text.length - lineStart)
  return { chars: text.length, lines, maxLineLen }
}

/** The profile for a pair of documents is the more restrictive of the two. */
export function diffProfileFor(a: string, b: string): FileProfile {
  const profiles = [profileFor(measureText(a)), profileFor(measureText(b))]
  if (profiles.includes('large')) return 'large'
  if (profiles.includes('longLines')) return 'longLines'
  return 'full'
}

/**
 * Bound the diff's cost. Precise diffing is quadratic on very different inputs; past these limits
 * the merge view falls back to its fast line-based diff instead of freezing the window.
 */
export function diffConfigFor(profile: FileProfile): DiffConfig {
  return profile === 'full' ? { scanLimit: 500, timeout: 200 } : { scanLimit: 100, timeout: 50 }
}

/**
 * Track whether a document differs from its saved baseline and report only the flips, so a host
 * re-renders when the dirty flag changes rather than on every keystroke.
 */
export function createDirtyTracker(onDirtyChange: (dirty: boolean) => void) {
  let saved: Text | null = null
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const report = (next: boolean) => {
    if (next === dirty) return
    dirty = next
    onDirtyChange(next)
  }
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return {
    reset(doc: Text) {
      cancel()
      saved = doc
      report(false)
    },
    update(doc: Text) {
      cancel()
      const quick = quickDirty(doc, saved)
      if (quick !== undefined) {
        report(quick)
        return
      }
      timer = setTimeout(() => {
        timer = null
        report(saved !== null && !doc.eq(saved))
      }, EQ_CHECK_DELAY_MS)
    },
    dispose: cancel,
  }
}

/**
 * Load the grammar for `filePath` and install it in every view. Skipped outside the full profile,
 * exactly like the file editor; `isLive` lets a view destroyed while the grammar loads opt out.
 */
export async function applyLanguage(
  views: () => EditorView[],
  filePath: string,
  profile: FileProfile,
  isLive: () => boolean,
): Promise<void> {
  const id = resolveLanguageId(filePath.split(/[\\/]/).pop() ?? filePath)
  if (profile !== 'full' || id === 'plaintext') return
  const language = await loadLanguage(id)
  if (!isLive()) return
  for (const view of views()) view.dispatch({ effects: languageSlot.reconfigure(language) })
}
