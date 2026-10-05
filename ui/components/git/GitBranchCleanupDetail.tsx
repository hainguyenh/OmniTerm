import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, FileDiff, GitBranch, GitCommit, Loader2, ShieldCheck, Trash2, UserRound } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitBranchFileViewer } from './GitBranchFileViewer'
import './git-branch-viewer.css'
import type { BranchCleanupAnalysis } from './gitBranchCleanupUtils'
import type { GitBranchComparison, GitBranchInfo } from './gitTypes'

interface GitBranchCleanupDetailProps {
  cwd: string
  branch: GitBranchInfo
  defaultBranch?: string
  analysis: BranchCleanupAnalysis
  deleting?: boolean
  onDeleteSingle: (branchName: string) => void
}

export const GitBranchCleanupDetail: React.FC<GitBranchCleanupDetailProps> = ({
  cwd,
  branch,
  defaultBranch = 'master',
  analysis,
  deleting = false,
  onDeleteSingle,
}) => {
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [view, setView] = useState<'overview' | 'files'>('overview')

  useEffect(() => {
    let active = true
    setLoadingComparison(true)
    setComparison(null)
    setCompareError(null)

    const api = createGitAPI()
    api
      .compareBranches(cwd, defaultBranch, branch.name)
      .then((res) => {
        if (active) {
          setComparison(res)
          setLoadingComparison(false)
        }
      })
      .catch((err) => {
        if (active) {
          setCompareError(typeof err === 'string' ? err : 'Could not compare with base branch')
          setLoadingComparison(false)
        }
      })

    return () => {
      active = false
    }
  }, [cwd, defaultBranch, branch.name])

  return (
    <section className="git-branch-viewer" aria-label="Branch comparison viewer">
      <header className="git-branch-viewer-heading">
        <div className="git-branch-viewer-name">
          <GitBranch />
          <div>
            <strong title={branch.name}>{branch.name}</strong>
            <span>Compare with <b>{defaultBranch}</b></span>
          </div>
        </div>
        {!analysis.isProtected && <button
          type="button"
          className="git-control git-control-danger"
          disabled={deleting}
          onClick={() => onDeleteSingle(branch.name)}
        ><Trash2 />Review deletion</button>}
      </header>
      <div className="git-branch-viewer-tabs" role="group" aria-label="Branch inspector view">
        <button type="button" aria-pressed={view === 'overview'} onClick={() => setView('overview')}><ShieldCheck />Overview</button>
        <button type="button" aria-pressed={view === 'files'} onClick={() => setView('files')}><FileDiff />File changes{comparison && <span className="git-count">{comparison.files.length}</span>}</button>
        {loadingComparison && <Loader2 className="w-4 h-4 animate-spin text-theme-dim" aria-label="Loading comparison" />}
      </div>
      {view === 'files' ? (
        compareError ? <div className="git-maintenance-empty" role="alert">{compareError}</div> : comparison ? <GitBranchFileViewer
          key={branch.name}
          cwd={cwd}
          base={defaultBranch}
          target={branch.name}
          files={comparison.files}
        /> : <div className="git-maintenance-empty" role="status">Reading file differences…</div>
      ) : (
        <div className="git-branch-overview">
          <div className={`git-branch-assessment ${analysis.isProtected ? 'is-protected' : ''}`}>
            {analysis.isProtected ? <ShieldCheck /> : analysis.recommendation === 'high' ? <CheckCircle2 /> : <AlertTriangle />}
            <div>
              <h2>{analysis.isProtected ? 'Protected branch' : analysis.isCandidate ? 'Cleanup candidate' : 'Keep for now'}</h2>
              <ul>{analysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          </div>
          <div className="git-branch-facts">
            <div>
              <UserRound />
              <span>Last author</span>
              <strong>{branch.last_commit_author ?? 'Unknown'}</strong>
            </div>
            <div>
              <Clock3 />
              <span>Last activity</span>
              <strong title={analysis.formattedDate}>{analysis.relativeDate}</strong>
            </div>
            <div>
              <GitBranch />
              <span>Upstream</span>
              <strong>
                {branch.upstream ?? 'No tracking branch'}
                {branch.is_gone && <small> · remote gone</small>}
              </strong>
            </div>
          </div>
          <section className="git-branch-overview-section">
            <h3>Last commit</h3>
            <p>{branch.last_commit_message ?? 'No commit message available'}</p>
          </section>
          {compareError ? <p role="alert" className="text-theme-error">{compareError}</p> : comparison && (
            <>
              <div className="git-branch-comparison-metrics">
                <div>
                  <strong>{comparison.commits_ahead.length}</strong>
                  <span>commits ahead of {defaultBranch}</span>
                </div>
                <div>
                  <strong>{comparison.commits_behind.length}</strong>
                  <span>commits behind {defaultBranch}</span>
                </div>
                <button type="button" onClick={() => setView('files')}>
                  <strong>{comparison.files.length}</strong>
                  <span>changed files →</span>
                </button>
              </div>
              <section className="git-branch-overview-section">
                <h3>Commits unique to this branch</h3>
                {comparison.commits_ahead.length === 0 ? <div className="git-branch-merged">
                  <CheckCircle2 />
                  <span>No unique commits relative to {defaultBranch}.</span>
                </div> : <div className="git-branch-commit-list">{comparison.commits_ahead.map((commit) => <div key={commit.id}>
                  <GitCommit />
                  <div>
                    <strong title={commit.summary}>{commit.summary}</strong>
                    <span><code>{commit.short_id}</code> · {commit.author_name}</span>
                  </div>
                </div>)}</div>}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}
