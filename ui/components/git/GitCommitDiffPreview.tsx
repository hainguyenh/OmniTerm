import React, { useEffect, useState } from 'react'
import { ExternalLink, FileCode, Loader2, X } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import type { GitCommitFileChange, GitFileDiff } from './gitTypes'
import './git-commit-diff.css'

interface GitCommitDiffPreviewProps {
  cwd?: string
  commitId: string
  file: GitCommitFileChange
  onClose: () => void
  onOpenFullDiff?: (path: string, commitId: string) => void
}

export const GitCommitDiffPreview: React.FC<GitCommitDiffPreviewProps> = ({
  cwd,
  commitId,
  file,
  onClose,
  onOpenFullDiff,
}) => {
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cwd) return
    let active = true
    setLoading(true)
    setError(null)

    const api = createGitAPI()
    api
      .getCommitFileDiff(cwd, commitId, file.path, file.old_path)
      .then((res) => {
        if (active) {
          setDiff(res)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [cwd, commitId, file.path, file.old_path])

  return (
    <div className="git-commit-diff-preview" role="region" aria-label={`Diff for ${file.path}`}>
      <div className="git-commit-diff-header">
        <div className="git-commit-diff-title">
          <FileCode className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="git-commit-diff-filename" title={file.path}>
            {file.path}
          </span>
          <span className="git-commit-diff-badges">
            {file.additions > 0 && <span className="git-stat-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="git-stat-del">-{file.deletions}</span>}
          </span>
        </div>
        <div className="git-commit-diff-actions">
          {onOpenFullDiff && (
            <button
              type="button"
              className="git-icon-button"
              title="Open in full diff editor"
              aria-label="Open in full diff editor"
              onClick={() => onOpenFullDiff(file.path, commitId)}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            className="git-icon-button"
            title="Close diff preview"
            aria-label="Close diff preview"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="git-commit-diff-body">
        {loading ? (
          <div className="git-commit-diff-loading">
            <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
            <span>Loading file diff…</span>
          </div>
        ) : error ? (
          <div className="git-commit-diff-error">
            <span>Failed to load diff: {error}</span>
          </div>
        ) : file.is_binary || diff?.is_binary ? (
          <div className="git-commit-diff-empty">
            <span>Binary file cannot be previewed</span>
          </div>
        ) : !diff || diff.hunks.length === 0 ? (
          <div className="git-commit-diff-empty">
            <span>No textual changes in this file</span>
          </div>
        ) : (
          <div className="git-commit-diff-content">
            {diff.hunks.map((hunk, hIdx) => (
              <div key={hIdx} className="git-diff-hunk-block">
                <div className="git-diff-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, lIdx) => (
                  <div
                    key={lIdx}
                    className={`git-diff-row is-${line.line_type}`}
                  >
                    <span className="git-diff-lineno git-diff-lineno-old">
                      {line.old_lineno ?? ''}
                    </span>
                    <span className="git-diff-lineno git-diff-lineno-new">
                      {line.new_lineno ?? ''}
                    </span>
                    <span className="git-diff-prefix">
                      {line.line_type === 'addition'
                        ? '+'
                        : line.line_type === 'deletion'
                          ? '-'
                          : ' '}
                    </span>
                    <span className="git-diff-text">{line.content}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
