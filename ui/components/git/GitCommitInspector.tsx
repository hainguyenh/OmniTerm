import React, { useEffect, useState } from 'react'
import {
  Check,
  Clock3,
  Copy,
  FileCode,
  GitCommit,
  Loader2,
  UserRound,
  X,
} from 'lucide-react'

import type { GitCommitDetails, GitCommitFileChange, GitCommitSummary, GitFileStatus } from './gitTypes'
import { GitCommitDiffPreview } from './GitCommitDiffPreview'

interface GitCommitInspectorProps {
  cwd?: string
  selected: GitCommitSummary | null
  details: GitCommitDetails | null
  loadingDetails: boolean
  cherryPicking?: boolean
  onClose: () => void
  onCherryPick?: (commitId: string) => void
  onOpenFileDiff?: (path: string, commitId: string) => void
}

function statusBadgeLetter(status: GitFileStatus): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'modified':
      return 'M'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'type_changed':
      return 'T'
    default:
      return 'M'
  }
}

export const GitCommitInspector: React.FC<GitCommitInspectorProps> = ({
  cwd,
  selected,
  details,
  loadingDetails,
  cherryPicking = false,
  onClose,
  onCherryPick,
  onOpenFileDiff,
}) => {
  const [copied, setCopied] = useState(false)
  const [previewFile, setPreviewFile] = useState<GitCommitFileChange | null>(null)

  useEffect(() => {
    setPreviewFile(null)
  }, [selected?.id])

  useEffect(() => {
    if (details && details.files.length > 0 && !previewFile) {
      setPreviewFile(details.files[0])
    }
  }, [details, previewFile])

  const handleCopyId = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  if (!selected) {
    return (
      <div className="git-maintenance-empty">
        <GitCommit />
        <strong>Inspect a commit</strong>
        <p>Select a row to see its author, parents, files and available actions.</p>
      </div>
    )
  }

  const messageBody = details?.full_message
    ? details.full_message.slice(selected.summary.length).trim()
    : null

  return (
    <div className="git-commit-inspector-root">
      <div className="git-commit-inspector-heading">
        <span>COMMIT DETAILS</span>
        <button
          type="button"
          className="git-icon-button"
          aria-label="Close commit details"
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      {/* ── Top Section: Commit Metadata (Left) + Changed Files (Right) ── */}
      <div className="git-commit-inspector-top">
        {/* Left column: commit metadata and actions */}
        <div className="git-commit-meta-col">
          <div className="flex items-center justify-between gap-2">
            <div className="git-commit-id">
              <GitCommit />
              <code>{selected.short_id}</code>
              <button
                type="button"
                className="git-icon-button"
                aria-label="Copy full commit SHA"
                title="Copy full commit SHA"
                onClick={(event) => void handleCopyId(selected.id, event)}
              >
                {copied ? <Check /> : <Copy />}
              </button>
            </div>
            {cwd && (
              <button
                type="button"
                className="git-control text-[11px] py-1 px-2 shrink-0"
                disabled={cherryPicking}
                title="Cherry-pick this commit into the current branch"
                aria-label="Cherry-pick commit"
                onClick={() => onCherryPick?.(selected.id)}
              >
                {cherryPicking ? <Loader2 className="animate-spin w-3 h-3" /> : <GitCommit className="w-3 h-3" />}
                Cherry-pick commit
              </button>
            )}
          </div>

          <h2 title={selected.summary}>{selected.summary}</h2>

          {messageBody && (
            <div className="git-commit-description" role="region" aria-label="Commit message body">
              <pre>{messageBody}</pre>
            </div>
          )}

          <div className="git-commit-metadata">
            <UserRound />
            <div>
              <strong>{selected.author_name}</strong>
              <span>{selected.author_email}</span>
            </div>
          </div>

          <div className="git-commit-metadata">
            <Clock3 />
            <span>{new Date(selected.timestamp * 1000).toLocaleString()}</span>
          </div>

          <div className="git-commit-parent-list">
            <span>PARENTS</span>
            {selected.parents.length === 0 ? (
              <p>Root commit</p>
            ) : (
              selected.parents.map((parent) => (
                <code key={parent}>{parent.slice(0, 12)}</code>
              ))
            )}
          </div>
        </div>

        {/* Right column: changed files list */}
        <div className="git-commit-files-col">
          <div className="git-commit-files-heading">
            <span className="git-commit-files-title">
              <FileCode className="w-3.5 h-3.5" />
              FILES CHANGED ({details ? details.total_files : loadingDetails ? '…' : 0})
            </span>
            {details && (details.total_additions > 0 || details.total_deletions > 0) && (
              <span className="git-commit-files-totals">
                {details.total_additions > 0 && (
                  <span className="git-stat-add">+{details.total_additions}</span>
                )}
                {details.total_deletions > 0 && (
                  <span className="git-stat-del">-{details.total_deletions}</span>
                )}
              </span>
            )}
          </div>

          {loadingDetails ? (
            <div className="git-commit-files-loading">
              <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
              <span>Loading changed files…</span>
            </div>
          ) : details && details.files.length > 0 ? (
            <div className="git-commit-files-list flex-1" role="list">
              {details.files.map((file) => (
                <div
                  key={file.path}
                  className={`git-commit-file-item ${previewFile?.path === file.path ? 'is-selected' : ''}`}
                  role="listitem"
                  onClick={() => setPreviewFile(file)}
                  title={`Preview diff: ${file.path}`}
                >
                  <span
                    className={`git-commit-file-badge is-${file.status}`}
                    title={`Status: ${file.status}`}
                  >
                    {statusBadgeLetter(file.status)}
                  </span>
                  <div className="git-commit-file-path" title={file.path}>
                    {file.old_path && (
                      <span className="git-commit-old-path">{file.old_path} → </span>
                    )}
                    <span>{file.path}</span>
                  </div>
                  <div className="git-commit-file-stats">
                    {file.is_binary ? (
                      <span className="git-stat-bin">bin</span>
                    ) : (
                      <>
                        {file.additions > 0 && (
                          <span className="git-stat-add">+{file.additions}</span>
                        )}
                        {file.deletions > 0 && (
                          <span className="git-stat-del">-{file.deletions}</span>
                        )}
                        {file.additions === 0 && file.deletions === 0 && (
                          <span className="git-stat-zero">0</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="git-commit-files-empty">
              <span>No file changes in this commit</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Section: Dedicated Diff View ── */}
      <div className="git-commit-inspector-diff-section">
        {previewFile ? (
          <GitCommitDiffPreview
            cwd={cwd}
            commitId={selected.id}
            file={previewFile}
            onClose={() => setPreviewFile(null)}
            onOpenFullDiff={onOpenFileDiff}
          />
        ) : (
          <div className="git-commit-diff-placeholder">
            <FileCode className="w-8 h-8 opacity-40 mb-2" />
            <span>Select a changed file above to inspect diff</span>
          </div>
        )}
      </div>
    </div>
  )
}
