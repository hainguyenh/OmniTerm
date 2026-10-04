import { goToNextChunk, goToPreviousChunk, MergeView } from '@codemirror/merge'
import { keymap } from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import { serialize } from './documentModel'
import {
  applyLanguage, createDirtyTracker, detectEol, diffConfigFor, diffProfileFor, type TextEditorHandle,
} from './diffEditorModel'
import { diffTheme } from './diffTheme'
import { buildExtensions } from './editorExtensions'
import { renderRevertControl } from './editorControls'
import './editor.css'

interface DiffEditorProps {
  /** Read-only left side, e.g. the committed or staged version. */
  original: string
  /** Editable right side, e.g. the working-tree file. */
  modified: string
  /** Used to pick the grammar. */
  filePath: string
  /** Fold unchanged stretches down to a few lines of context around each change. */
  collapseUnchanged: boolean
  readOnly?: boolean
  onDirtyChange: (dirty: boolean) => void
}

const COLLAPSE = { margin: 3, minSize: 4 }

/** VS Code's diff-editor keys for jumping between changes. */
const chunkKeymap = keymap.of([
  { key: 'F7', run: goToNextChunk },
  { key: 'Shift-F7', run: goToPreviousChunk },
])

const ignoreUpdate = () => undefined

/**
 * Side-by-side diff built from the file editor's CodeMirror setup.
 *
 * The diff is recomputed incrementally as the right side is edited, only the viewport is rendered,
 * and keystrokes never re-render React: the host hears about dirty-flag flips and pulls the text
 * through the handle when it saves. A new `original`/`modified` pair rebuilds the view.
 */
export const DiffEditor = forwardRef<TextEditorHandle, DiffEditorProps>(function DiffEditor(
  { original, modified, filePath, collapseUnchanged, readOnly = false, onDirtyChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)
  const trackerRef = useRef<ReturnType<typeof createDirtyTracker> | null>(null)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const collapseRef = useRef(collapseUnchanged)
  collapseRef.current = collapseUnchanged

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const profile = diffProfileFor(original, modified)
    const tracker = createDirtyTracker((dirty) => onDirtyChangeRef.current(dirty))
    const view = new MergeView({
      parent: host,
      a: {
        doc: original,
        extensions: [buildExtensions({ profile, readOnly: true, onUpdate: ignoreUpdate }), chunkKeymap, diffTheme],
      },
      b: {
        doc: modified,
        extensions: [
          buildExtensions({
            profile,
            readOnly,
            onUpdate: (update) => {
              if (update.docChanged) tracker.update(update.state.doc)
            },
          }),
          chunkKeymap,
          diffTheme,
        ],
      },
      revertControls: readOnly ? undefined : 'a-to-b',
      renderRevertControl,
      gutter: true,
      // Word-level highlighting walks every changed line; large documents keep line-level marks only.
      highlightChanges: profile === 'full',
      collapseUnchanged: collapseRef.current ? COLLAPSE : undefined,
      diffConfig: diffConfigFor(profile),
    })
    viewRef.current = view
    trackerRef.current = tracker
    tracker.reset(view.b.state.doc)
    let live = true
    void applyLanguage(() => [view.a, view.b], filePath, profile, () => live)
    return () => {
      live = false
      tracker.dispose()
      if (viewRef.current === view) viewRef.current = null
      if (trackerRef.current === tracker) trackerRef.current = null
      view.destroy()
    }
  }, [original, modified, filePath, readOnly])

  useEffect(() => {
    viewRef.current?.reconfigure({ collapseUnchanged: collapseUnchanged ? COLLAPSE : undefined })
  }, [collapseUnchanged])

  useImperativeHandle(ref, () => {
    const eol = detectEol(modified)
    return {
      getText: () => {
        const view = viewRef.current
        return view ? serialize(view.b.state.doc, eol) : modified
      },
      markSaved: () => {
        const view = viewRef.current
        if (view) trackerRef.current?.reset(view.b.state.doc)
      },
    }
  }, [modified])

  return <div ref={hostRef} className="diff-editor" />
})
