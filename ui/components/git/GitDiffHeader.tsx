import { Check, ChevronLeft, ChevronRight, FileCode2, FileDiff, Loader2, Minus, Save, X } from 'lucide-react'

import { fileKindMeta } from '../../utils/fileKind'
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
      <div className="git-diff-identity">
        <div className="git-diff-filename" title={props.filePath}>
          <span className="git-diff-file-icon" style={{ color: meta.color }}>
            <FileIcon />
          </span>
          <div>
            <strong>{name}</strong>
            <span>{directory || 'Repository root'}</span>
          </div>
        </div>
        <div className="git-diff-stats" aria-label={`${props.additions} lines added, ${props.deletions} lines removed`}>
          <span className="git-status-added">+{props.additions}</span>
          <span className="git-status-deleted">−{props.deletions}</span>
        </div>
        {props.dirty && <span className="git-status-badge git-status-untracked">Unsaved</span>}
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
            onClick={() => props.onViewMode('diff')}
            title="Fold unchanged lines; keep context around changes"
          ><FileDiff />Changes only</button>
          <button
            type="button"
            aria-pressed={props.viewMode === 'full'}
            onClick={() => props.onViewMode('full')}
            title="Show all lines in both versions"
          ><FileCode2 />Full file</button>
        </div>
        <div className="git-diff-edit-actions">
          <button
            type="button"
            className="git-control"
            onClick={props.onSave}
            disabled={props.saving || !props.dirty}
            title="Save local edits · Ctrl+S"
          >
            {props.saving ? <Loader2 className="animate-spin" /> : <Save />}Save
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
      {props.notice && <div className="git-diff-notice" role="status">{props.notice}</div>}
    </>
  )
}
