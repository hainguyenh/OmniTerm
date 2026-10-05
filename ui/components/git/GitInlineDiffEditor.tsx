import { forwardRef, useMemo } from 'react'
import { LockKeyhole, PencilLine } from 'lucide-react'

import { DiffEditor } from '../editor/DiffEditor'
import type { TextEditorHandle } from '../editor/diffEditorModel'
import { GitConflictEditor } from './GitConflictEditor'
import { hasConflictMarkers } from './gitConflictUtils'

interface GitInlineDiffEditorProps {
  /** The working-tree text as loaded; edits stay inside the editor until the host saves. */
  localContent: string
  serverContent: string
  filePath: string
  viewMode: 'diff' | 'full'
  baseLabel?: string
  modifiedLabel?: string
  onDirtyChange: (dirty: boolean) => void
}

/**
 * The git diff body: a 3-way conflict editor when the loaded file carries conflict markers, else the
 * shared side-by-side `DiffEditor`. The layout is chosen from the loaded text, not live edits, so
 * resolving the last conflict does not swap the editor out from under the cursor.
 */
export const GitInlineDiffEditor = forwardRef<TextEditorHandle, GitInlineDiffEditorProps>(function GitInlineDiffEditor(
  { localContent, serverContent, filePath, viewMode, baseLabel = 'Base version', modifiedLabel = 'Working copy', onDirtyChange },
  ref,
) {
  const isConflict = useMemo(() => hasConflictMarkers(localContent), [localContent])

  if (isConflict) {
    return <GitConflictEditor ref={ref} content={localContent} filePath={filePath} onDirtyChange={onDirtyChange} />
  }

  return (
    <div className="flex flex-col h-full bg-theme-bg overflow-hidden text-xs font-mono">
      <div className="git-diff-columns with-revert">
        <div className="git-diff-column is-base">
          <strong><LockKeyhole />{baseLabel}</strong><span>Read-only · removed lines</span>
        </div>
        <div className="git-diff-chunk-column" title="Revert individual changes to the base version">Chunks</div>
        <div className="git-diff-column is-editable">
          <strong><PencilLine />{modifiedLabel}</strong><span>Editable · added lines</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 select-text">
        <DiffEditor
          ref={ref}
          original={serverContent}
          modified={localContent}
          filePath={filePath}
          collapseUnchanged={viewMode === 'diff'}
          onDirtyChange={onDirtyChange}
        />
      </div>
    </div>
  )
})
