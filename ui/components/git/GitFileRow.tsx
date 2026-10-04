import React from 'react'
import { CheckSquare, Minus, Plus, Square } from 'lucide-react'

import { FileTypeIcon } from '../FileTypeIcon'
import { getFileExtension } from './gitTreeUtils'
import type { GitFileChange, GitFileStatus } from './gitTypes'

const STATUS_LABELS: Record<GitFileStatus, string> = {
  added: 'Added',
  deleted: 'Deleted',
  untracked: 'Untracked',
  renamed: 'Renamed',
  modified: 'Modified',
  unmodified: 'Unchanged',
  copied: 'Copied',
  conflicted: 'Conflict',
  ignored: 'Ignored',
  type_changed: 'Type changed',
}

interface GitFileRowProps {
  file: GitFileChange
  displayName: string
  depth?: number
  isChecked: boolean
  isSelected: boolean
  isStaged: boolean
  staging?: boolean
  onToggleCheck: (path: string, e: React.MouseEvent) => void
  onSelect: (path: string, isStaged: boolean) => void
  onContextMenu: (e: React.MouseEvent, path: string, isStaged: boolean) => void
  onToggleStage?: (path: string, isStaged: boolean) => void
}

export const GitFileRow: React.FC<GitFileRowProps> = ({
  file,
  displayName,
  depth = 0,
  isChecked,
  isSelected,
  isStaged,
  staging = false,
  onToggleCheck,
  onSelect,
  onContextMenu,
  onToggleStage,
}) => {
  const status = file.is_conflicted ? 'conflicted' : isStaged ? file.staged : file.unstaged

  return (
    <div
      onContextMenu={(e) => onContextMenu(e, file.path, isStaged)}
      style={{ paddingInlineStart: `${Math.min(depth, 6) * 16 + 8}px` }}
      className={`git-file-row ${isSelected ? 'git-file-row-selected' : ''}`}
    >
      <button
        type="button"
        onClick={(e) => onToggleCheck(file.path, e)}
        className="git-icon-button git-check-button"
        aria-label={isChecked ? `Uncheck ${displayName}` : `Check ${displayName}`}
        aria-pressed={isChecked}
      >
        {isChecked ? <CheckSquare className="text-theme-accent" /> : <Square />}
      </button>

      <button
        type="button"
        onClick={() => onSelect(file.path, isStaged)}
        className="git-file-open"
        aria-label={`View ${isStaged ? 'staged' : 'working tree'} diff for ${file.path}`}
        aria-pressed={isSelected}
        title={file.path}
      >
        <FileTypeIcon name={file.path} kind={getFileExtension(file.path)} ignored={status === 'ignored'} />
        <span className="truncate">{displayName}</span>
      </button>

      <span className={`git-status-badge git-status-${status}`} title={STATUS_LABELS[status]}>
        {STATUS_LABELS[status]}
      </span>

      {onToggleStage && (
        <button
          type="button"
          onClick={() => onToggleStage(file.path, isStaged)}
          disabled={staging}
          className={`git-file-stage git-control ${isStaged ? '' : 'git-stage-action'}`}
          aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${file.path}`}
          title={isStaged ? 'Remove from the next commit' : 'Include in the next commit'}
        >
          {isStaged ? <Minus /> : <Plus />}
          <span>{isStaged ? 'Unstage' : 'Stage'}</span>
        </button>
      )}
    </div>
  )
}
