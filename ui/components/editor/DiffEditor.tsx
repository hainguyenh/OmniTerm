import { MergeView } from '@codemirror/merge'
import { EditorView, keymap } from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import { serialize } from './documentModel'
import {
  applyLanguage, changeIndexAt, createDirtyTracker, detectEol, diffConfigFor, diffProfileFor, nextChangeIndex,
  type ChangePosition, type ChangeSpan, type TextEditorHandle,
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
  /** Hears which change the cursor is on whenever that, or the number of changes, moves. */
  onChangePosition?: (position: ChangePosition) => void
}

const COLLAPSE = { margin: 3, minSize: 4 }

const ignoreUpdate = () => undefined

function changesOf(view: MergeView): ChangeSpan[] {
  return view.chunks.map((chunk) => ({ from: chunk.fromB, to: chunk.toB }))
}

/** Put the cursor on a change of the editable side and scroll it to the middle of the view. */
function revealChange(view: MergeView, index: number) {
  const chunk = view.chunks[index]
  if (!chunk) return
  const anchor = Math.min(chunk.fromB, view.b.state.doc.length)
  view.b.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    userEvent: 'select.byChunk',
  })
}

/**
 * Side-by-side diff built from the file editor's CodeMirror setup.
 *
 * The diff is recomputed incrementally as the right side is edited, only the viewport is rendered,
 * and keystrokes never re-render React: the host hears about dirty-flag flips and pulls the text
 * through the handle when it saves. A new `original`/`modified` pair rebuilds the view.
 */
export const DiffEditor = forwardRef<TextEditorHandle, DiffEditorProps>(function DiffEditor(
  { original, modified, filePath, collapseUnchanged, readOnly = false, onDirtyChange, onChangePosition },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)
  const trackerRef = useRef<ReturnType<typeof createDirtyTracker> | null>(null)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const collapseRef = useRef(collapseUnchanged)
  collapseRef.current = collapseUnchanged
  const onChangePositionRef = useRef(onChangePosition)
  onChangePositionRef.current = onChangePosition
  const lastPosition = useRef<ChangePosition | null>(null)

  const reportPosition = (view: MergeView) => {
    const changes = changesOf(view)
    const next = { index: changeIndexAt(changes, view.b.state.selection.main.head), count: changes.length }
    const last = lastPosition.current
    if (last && last.index === next.index && last.count === next.count) return
    lastPosition.current = next
    onChangePositionRef.current?.(next)
  }
  const reportRef = useRef(reportPosition)
  reportRef.current = reportPosition

  const goToChange = (direction: 1 | -1) => {
    const view = viewRef.current
    if (!view || view.chunks.length === 0) return false
    revealChange(view, nextChangeIndex(changesOf(view), view.b.state.selection.main.head, direction))
    return true
  }
  const goToChangeRef = useRef(goToChange)
  goToChangeRef.current = goToChange

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const profile = diffProfileFor(original, modified)
    const tracker = createDirtyTracker((dirty) => onDirtyChangeRef.current(dirty))
    // VS Code's diff-editor keys for jumping between changes, from either side.
    const changeKeymap = keymap.of([
      { key: 'F7', run: () => goToChangeRef.current(1) },
      { key: 'Shift-F7', run: () => goToChangeRef.current(-1) },
    ])
    const report = () => {
      if (viewRef.current) reportRef.current(viewRef.current)
    }
    const view = new MergeView({
      parent: host,
      a: {
        doc: original,
        extensions: [buildExtensions({ profile, readOnly: true, onUpdate: ignoreUpdate }), changeKeymap, diffTheme],
      },
      b: {
        doc: modified,
        extensions: [
          buildExtensions({
            profile,
            readOnly,
            onUpdate: (update) => {
              if (update.docChanged) tracker.update(update.state.doc)
              if (update.docChanged || update.selectionSet) report()
            },
          }),
          changeKeymap,
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
    lastPosition.current = null
    // Open on the first change: in a full-file view it can sit far below the fold.
    revealChange(view, 0)
    report()
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
      goToChange: (direction) => {
        goToChangeRef.current(direction)
      },
    }
  }, [modified])

  return <div ref={hostRef} className="diff-editor" />
})
