import { forwardRef, useMemo, useRef } from 'react'
import type React from 'react'
import { GripVertical, LockKeyhole, PencilLine } from 'lucide-react'

import { DiffEditor } from '../editor/DiffEditor'
import type { ChangePosition, TextEditorHandle } from '../editor/diffEditorModel'
import { GitConflictEditor } from './GitConflictEditor'
import { hasConflictMarkers } from './gitConflictUtils'
import { usePaneSplit } from './usePaneSplit'

interface GitInlineDiffEditorProps {
  /** The working-tree text as loaded; edits stay inside the editor until the host saves. */
  localContent: string
  serverContent: string
  filePath: string
  viewMode: 'diff' | 'full'
  baseLabel?: string
  modifiedLabel?: string
  onDirtyChange: (dirty: boolean) => void
  onChangePosition?: (position: ChangePosition) => void
}

/** Width of the revert-chunk gutter between the two sides; matches `.cm-merge-revert`. */
const CHUNK_GUTTER_PX = 72
const SPLIT_BOUNDS = { min: 0.15, max: 0.85 }

/**
 * The git diff body: a 3-way conflict editor when the loaded file carries conflict markers, else the
 * shared side-by-side `DiffEditor`. The layout is chosen from the loaded text, not live edits, so
 * resolving the last conflict does not swap the editor out from under the cursor.
 */
export const GitInlineDiffEditor = forwardRef<TextEditorHandle, GitInlineDiffEditorProps>(function GitInlineDiffEditor(
  {
    localContent,
    serverContent,
    filePath,
    viewMode,
    baseLabel = 'Base version',
    modifiedLabel = 'Working copy',
    onDirtyChange,
    onChangePosition,
  },
  ref,
) {
  const isConflict = useMemo(() => hasConflictMarkers(localContent), [localContent])
  const containerRef = useRef<HTMLDivElement>(null)
  // The share of the width the base side takes; the working copy gets the rest.
  const split = usePaneSplit({
    storageKey: 'omniterm:git-diff-split',
    defaultValue: 0.5,
    bounds: () => SPLIT_BOUNDS,
    unitsPerPixel: () => 1 / Math.max(1, (containerRef.current?.clientWidth ?? 0) - CHUNK_GUTTER_PX),
    step: 0.05,
  })

  if (isConflict) {
    return <GitConflictEditor ref={ref} content={localContent} filePath={filePath} onDirtyChange={onDirtyChange} />
  }

  const ratio = Math.min(SPLIT_BOUNDS.max, Math.max(SPLIT_BOUNDS.min, split.value))
  return (
    <div
      ref={containerRef}
      className={`git-diff-split flex flex-col h-full bg-theme-bg overflow-hidden text-xs font-mono ${split.dragging ? 'is-resizing' : ''}`}
      style={{ '--git-diff-split': ratio } as React.CSSProperties}
    >
      <div className="git-diff-columns with-revert">
        <div className="git-diff-column is-base">
          <strong><LockKeyhole />{baseLabel}</strong><span>Read-only · removed lines</span>
        </div>
        <div
          {...split.separatorProps}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={SPLIT_BOUNDS.min * 100}
          aria-valuemax={SPLIT_BOUNDS.max * 100}
          aria-label="Resize base and working copy panes"
          className="git-diff-chunk-column git-diff-split-handle"
          title="Drag to resize the two sides · double-click to reset"
        >
          <GripVertical aria-hidden="true" />Chunks
        </div>
        <div className="git-diff-column is-editable">
          <strong><PencilLine />{modifiedLabel}</strong><span>Editable · added lines</span>
        </div>
      </div>
      <div className="git-diff-split-body flex-1 min-h-0 select-text">
        <DiffEditor
          ref={ref}
          original={serverContent}
          modified={localContent}
          filePath={filePath}
          collapseUnchanged={viewMode === 'diff'}
          onDirtyChange={onDirtyChange}
          onChangePosition={onChangePosition}
        />
      </div>
    </div>
  )
})
