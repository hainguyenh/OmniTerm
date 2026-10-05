import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileCode2, FileDiff, Loader2, Minus, Save, X } from 'lucide-react'

import { fileKindMeta } from '../../utils/fileKind'
import type { ChangePosition } from '../editor/diffEditorModel'
import { getFileExtension } from './gitTreeUtils'

interface GitDiffHeaderProps {
  filePath: string
  staged: boolean
  targetBranch?: string
  additions: number
  deletions: number
  dirty: boolean
  saving: boolean
  staging: boolean
  notice: string | null
  viewMode: 'diff' | 'full'
  index: number
  count: number
  hasPrev: boolean
  hasNext: boolean
  /** Null while the body is not a diff, e.g. the conflict editor or a binary file. */
  change: ChangePosition | null
  onPrevChange: () => void
  onNextChange: () => void
  onPrev: () => void
  onNext: () => void
  onStage: () => void
  onSave: () => void
  onClose: () => void
  onSelectVersion: (staged: boolean) => void
  onViewMode: (mode: 'diff' | 'full') => void
}

export function GitDiffHeader(props: GitDiffHeaderProps) {
  const meta = fileKindMeta(getFileExtension(props.filePath))
  const FileIcon = meta.icon
  const segments = props.filePath.split(/[\\/]/)
  const name = segments.pop()
  const directory = segments.join('/')
  return (
    <>
      <div className="git-diff-header">
        <div className="git-diff-filename" title={props.filePath}>
          <span className="git-diff-file-icon" style={{ color: meta.color }}>
            <FileIcon />
          </span>
          <div>
            <strong>{name}</strong>
            <span>{directory || 'Repository root'}</span>
          </div>
        </div>
        <div className="git-diff-toolbar">
          {props.targetBranch ? <span className="git-status-badge">Compare with {props.targetBranch}</span> : (
            <div className="git-segmented" role="group" aria-label="Diff version">
              <button type="button" aria-pressed={!props.staged} onClick={() => props.onSelectVersion(false)}>Working tree</button>
              <button type="button" aria-pressed={props.staged} onClick={() => props.onSelectVersion(true)}>Staged</button>
            </div>
          )}
          <div className="git-segmented" role="group" aria-label="Diff context">
            <button
              type="button"
              aria-pressed={props.viewMode === 'diff'}
              aria-label="Changes only"
              onClick={() => props.onViewMode('diff')}
              title="Fold unchanged lines; keep context around changes"
            ><FileDiff /><span>Changes only</span></button>
            <button
              type="button"
              aria-pressed={props.viewMode === 'full'}
              aria-label="Full file"
              onClick={() => props.onViewMode('full')}
              title="Show all lines in both versions"
            ><FileCode2 /><span>Full file</span></button>
          </div>
          <div className="git-diff-edit-actions">
            <button
              type="button"
              className="git-control"
              onClick={props.onSave}
              disabled={props.saving || !props.dirty}
              title="Save local edits · Ctrl+S"
              aria-label="Save"
            >
              {props.saving ? <Loader2 className="animate-spin" /> : <Save />}<span>Save</span>
            </button>
            {!props.targetBranch && (
              <button
                type="button"
                className={`git-control ${props.staged ? '' : 'git-primary'}`}
                onClick={props.onStage}
                disabled={props.staging}
              >
                {props.staging ? <Loader2 className="animate-spin" /> : props.staged ? <Minus /> : <Check />}
                {props.staged ? 'Unstage' : 'Stage file'}
              </button>
            )}
          </div>
        </div>
        <div className="git-diff-header-trailing">
          <div className="git-diff-stats" aria-label={`${props.additions} lines added, ${props.deletions} lines removed`}>
            <span className="git-status-added">+{props.additions}</span>
            <span className="git-status-deleted">−{props.deletions}</span>
          </div>
          {props.dirty && <span className="git-status-badge git-status-untracked">Unsaved</span>}
          {props.change && props.change.count > 0 && (
            <div className="git-diff-navigation" role="group" aria-label="Change navigation">
              <button
                type="button"
                className="git-icon-button"
                aria-label="Previous change"
                title="Previous change · Shift+F7"
                onClick={props.onPrevChange}
              >
                <ChevronUp />
              </button>
              <span aria-live="polite" title="Change under the cursor">
                {props.change.index >= 0 ? props.change.index + 1 : '–'} / {props.change.count}
              </span>
              <button
                type="button"
                className="git-icon-button"
                aria-label="Next change"
                title="Next change · F7"
                onClick={props.onNextChange}
              >
                <ChevronDown />
              </button>
            </div>
          )}
          {props.count > 1 && (
            <div className="git-diff-navigation" role="group" aria-label="File navigation">
              <button
                type="button"
                className="git-icon-button"
                aria-label="Previous file"
                title="Previous file · Alt+Left"
                disabled={!props.hasPrev}
                onClick={props.onPrev}
              >
                <ChevronLeft />
              </button>
              <span>{props.index + 1} / {props.count}</span>
              <button
                type="button"
                className="git-icon-button"
                aria-label="Next file"
                title="Next file · Alt+Right"
                disabled={!props.hasNext}
                onClick={props.onNext}
              >
                <ChevronRight />
              </button>
            </div>
          )}
          <button
            type="button"
            className="git-icon-button"
            aria-label="Close diff"
            title="Close diff · Esc"
            onClick={props.onClose}
          >
            <X />
          </button>
        </div>
      </div>
      {props.notice && <div className="git-diff-notice" role="status">{props.notice}</div>}
    </>
  )
}
