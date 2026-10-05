import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ArrowLeft, ArrowRight, CheckCircle2, GitMerge, LockKeyhole } from 'lucide-react'

import { serialize } from '../editor/documentModel'
import { applyLanguage, createDirtyTracker, detectEol, measureText, type TextEditorHandle } from '../editor/diffEditorModel'
import { buildExtensions } from '../editor/editorExtensions'
import { profileFor } from '../editor/fileProfile'
import '../editor/editor.css'
import './git-conflict.css'
import { type ConflictBlock, conflictResolutionChange, parseConflictBlocks } from './gitConflictUtils'

interface GitConflictEditorProps {
  content: string
  filePath: string
  onDirtyChange: (dirty: boolean) => void
}

/** Typing re-parses the conflict blocks only after it pauses; accepting a side re-parses at once. */
const REPARSE_DELAY_MS = 200

/**
 * 3-way conflict layout: incoming blocks on the left, the editable result in the middle (the file
 * editor's CodeMirror setup), current blocks on the right. Accepting a side is applied as one edit
 * to the result, so it can be undone like any other change.
 */
export const GitConflictEditor = forwardRef<TextEditorHandle, GitConflictEditorProps>(function GitConflictEditor(
  { content, filePath, onDirtyChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const trackerRef = useRef<ReturnType<typeof createDirtyTracker> | null>(null)
  const reparseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange

  const [snapshot, setSnapshot] = useState(content)
  const blocks = useMemo(() => parseConflictBlocks(snapshot), [snapshot])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const profile = profileFor(measureText(content))
    const tracker = createDirtyTracker((dirty) => onDirtyChangeRef.current(dirty))
    const cancelReparse = () => {
      if (reparseTimer.current) clearTimeout(reparseTimer.current)
      reparseTimer.current = null
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: buildExtensions({
          profile,
          readOnly: false,
          onUpdate: (update) => {
            if (!update.docChanged) return
            const doc = update.state.doc
            tracker.update(doc)
            cancelReparse()
            reparseTimer.current = setTimeout(() => {
              reparseTimer.current = null
              setSnapshot(doc.toString())
            }, REPARSE_DELAY_MS)
          },
        }),
      }),
    })
    viewRef.current = view
    trackerRef.current = tracker
    tracker.reset(view.state.doc)
    let live = true
    void applyLanguage(() => [view], filePath, profile, () => live)
    return () => {
      live = false
      cancelReparse()
      tracker.dispose()
      if (viewRef.current === view) viewRef.current = null
      if (trackerRef.current === tracker) trackerRef.current = null
      view.destroy()
    }
  }, [content, filePath])

  useImperativeHandle(ref, () => {
    const eol = detectEol(content)
    return {
      getText: () => {
        const view = viewRef.current
        return view ? serialize(view.state.doc, eol) : content
      },
      markSaved: () => {
        const view = viewRef.current
        if (view) trackerRef.current?.reset(view.state.doc)
      },
    }
  }, [content])

  const accept = (block: ConflictBlock, choice: 'theirs' | 'ours') => {
    const view = viewRef.current
    if (!view) return
    // The rendered blocks may trail the document by one reparse delay; resolve against the live text.
    const current = parseConflictBlocks(view.state.doc.toString())[block.index]
    if (!current) return
    view.dispatch({ changes: conflictResolutionChange(view.state.doc, current, choice) })
    if (reparseTimer.current) clearTimeout(reparseTimer.current)
    reparseTimer.current = null
    setSnapshot(view.state.doc.toString())
  }

  const syncScroll = (source: HTMLDivElement) => {
    const other = source === leftScrollRef.current ? rightScrollRef.current : leftScrollRef.current
    if (other) other.scrollTop = source.scrollTop
  }

  return (
    <div className="git-conflict-editor flex flex-col h-full bg-theme-bg overflow-hidden text-xs font-mono select-none">
      <div className="git-conflict-banner">
        <div className={`flex items-center gap-1.5 font-semibold ${blocks.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
          <GitMerge className="w-4 h-4" /><span>{blocks.length > 0 ? `Merge Conflicts: ${blocks.length} remaining` : 'All conflicts resolved'}</span>
        </div>
        <span className="text-theme-dim text-[10px]">
          Choose Incoming or Current for each conflict. Edit the result, then save.
        </span>
      </div>

      <div className="git-conflict-panes">
        {/* LEFT: Server / Incoming (Theirs) */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-theme-bg/40">
          <div className="git-conflict-pane-heading is-incoming">
            <strong>Incoming changes</strong>
            <span className="git-conflict-readonly"><LockKeyhole />Read-only</span>
          </div>
          <div
            ref={leftScrollRef}
            onScroll={(e) => syncScroll(e.currentTarget)}
            className="flex-1 overflow-auto p-2 custom-scrollbar space-y-4"
          >
            {blocks.map((block) => (
              <div key={block.index} className="git-conflict-block is-incoming">
                <div className="git-conflict-block-heading">
                  <span>Conflict {block.index + 1}</span>
                  <button
                    type="button"
                    onClick={() => accept(block, 'theirs')}
                    className="git-conflict-accept"
                    title="Replace this conflict in the result with incoming changes"
                  >
                    <span>Use incoming</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <pre className="text-theme-fg whitespace-pre-wrap break-all leading-5 font-mono">
                  {block.theirs || <span className="italic text-theme-dim">(empty)</span>}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: Result · final version */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-theme-bg relative select-text">
          <div className="git-conflict-pane-heading is-result">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Result · final version</span>
            </span>
            <span className="text-[10px] text-emerald-400/80 font-normal">Edit & save</span>
          </div>
          <div ref={hostRef} className="conflict-editor-code flex-1" />
        </div>

        {/* RIGHT: Local / Current (Ours) */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-theme-bg/40">
          <div className="git-conflict-pane-heading is-current">
            <strong>Current changes</strong>
            <span className="git-conflict-readonly"><LockKeyhole />Read-only</span>
          </div>
          <div
            ref={rightScrollRef}
            onScroll={(e) => syncScroll(e.currentTarget)}
            className="flex-1 overflow-auto p-2 custom-scrollbar space-y-4"
          >
            {blocks.map((block) => (
              <div key={block.index} className="git-conflict-block is-current">
                <div className="git-conflict-block-heading">
                  <button
                    type="button"
                    onClick={() => accept(block, 'ours')}
                    className="git-conflict-accept"
                    title="Replace this conflict in the result with current changes"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>Use current</span>
                  </button>
                  <span>Conflict {block.index + 1}</span>
                </div>
                <pre className="text-theme-fg whitespace-pre-wrap break-all leading-5 font-mono">
                  {block.ours || <span className="italic text-theme-dim">(empty)</span>}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
