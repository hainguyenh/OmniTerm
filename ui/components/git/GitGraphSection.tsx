import React, { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  GitCommit,
  GitGraph,
  Loader2,
  RefreshCw,
  Search,
  GitMerge,
  UserRound,
  Clock3,
  X,
} from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitGraphLanes } from './GitGraphLanes'
import { layoutGraph } from './gitGraphLayout'
import './git-graph.css'
import type { GitCommitSummary } from './gitTypes'

interface GitGraphSectionProps {
  cwd?: string
  commits: GitCommitSummary[]
  loading: boolean
  onRefresh: () => void
  onSelectCommit?: (commit: GitCommitSummary) => void
}

function formatRelativeTime(timestampSec: number): string {
  if (!timestampSec) return ''
  const diffSec = Math.floor(Date.now() / 1000 - timestampSec)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(timestampSec * 1000).toLocaleDateString()
}

export const GitGraphSection: React.FC<GitGraphSectionProps> = ({
  cwd,
  commits,
  loading,
  onRefresh,
  onSelectCommit,
}) => {
  const [selected, setSelected] = useState<GitCommitSummary | null>(null)
  const [copied, setCopied] = useState(false)
  const [cherryPicking, setCherryPicking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const graph = useMemo(() => layoutGraph(commits), [commits])
  const query = search.trim().toLowerCase()
  const matching = commits.filter((commit) => `${commit.summary} ${commit.author_name} ${commit.id}`.toLowerCase().includes(query))

  const api = createGitAPI()

  const handleCherryPick = async (commitId: string) => {
    if (!cwd || cherryPicking) return
    setCherryPicking(true)
    setNotice(null)
    try {
      const res = await api.cherryPick(cwd, commitId)
      setNotice(res || `Cherry-pick of ${commitId.slice(0, 7)} succeeded`)
      onRefresh()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err: unknown) {
      setNotice(`Cherry-pick failed: ${String(err)}`)
    } finally {
      setCherryPicking(false)
    }
  }

  const handleSelect = (commit: GitCommitSummary) => {
    setSelected(commit.id === selected?.id ? null : commit)
    onSelectCommit?.(commit)
  }

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

  return (
    <section className="git-history git-menu" aria-label="Commit graph">
      <header className="git-history-header">
        <div className="git-section-title">
          <GitGraph />
          <div>
            <h1>Commit Graph</h1>
            <p>A continuous view of your repository’s history.</p>
          </div>
        </div>
        <label className="git-search">
          <Search className="w-4 h-4 text-theme-dim" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a commit, author or SHA…"
            aria-label="Search commit history"
          />
        </label>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="git-control"
          aria-label="Refresh commit history"
        ><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
      </header>
      {notice && <div className="git-history-notice" role="status">
        <span>{notice}</span>
        <button
          type="button"
          className="git-icon-button"
          aria-label="Dismiss commit notice"
          onClick={() => setNotice(null)}
        >
          <X />
        </button>
      </div>}
      <div className="git-history-body">
        <div className="git-history-scroll">
          <div className="git-history-table" style={{ '--graph-width': `${graph.width}px` } as React.CSSProperties}>
            <div className="git-history-columns">
              <span>TREE</span>
              <span>COMMIT</span>
              <span>AUTHOR</span>
              <span>WHEN</span>
              <span>SHA</span>
            </div>
            <div className="git-history-entries">
            {commits.length > 0 && matching.length > 0 && <div className="git-history-graph" aria-hidden="true">
              <GitGraphLanes
                rows={graph.rows}
                width={graph.width}
                selectedIndex={commits.findIndex((commit) => commit.id === selected?.id)}
                merges={commits.map((commit) => commit.parents.length > 1)}
              />
            </div>}
            {commits.length === 0 ? <div className="git-maintenance-empty">
              <GitCommit />
              <strong>{loading ? 'Loading history…' : 'No commits found'}</strong>
            </div> : matching.length === 0 ? <div className="git-maintenance-empty">
              <Search />
              <strong>No matching commits</strong>
              <p>Try another message, author or SHA.</p>
            </div> : commits.map((commit, index) => {
              const isSelected = selected?.id === commit.id
              const isMatch = !query || matching.includes(commit)
              return (
                <button
                  key={commit.id}
                  type="button"
                  className={`git-history-row ${isSelected ? 'is-selected' : ''} ${isMatch ? '' : 'is-muted'}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSelect(commit)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setSelected(commit)
                  }}
                >
                  <span className="git-history-graph-cell" aria-hidden="true" />
                  <span className="git-history-message">
                    {commit.parents.length > 1 && <GitMerge className="git-history-merge" />}
                    <strong title={commit.summary}>{commit.summary}</strong>
                    {index === 0 && <span className="git-head-label">Latest</span>}
                  </span>
                  <span className="git-history-author" title={commit.author_name}>{commit.author_name}</span>
                  <span className="git-history-time">{formatRelativeTime(commit.timestamp)}</span>
                  <span className="git-history-sha">{commit.short_id}</span>
                </button>
              )
            })}
            </div>
          </div>
        </div>
        <aside className={`git-commit-inspector ${selected ? '' : 'is-empty'}`} aria-label="Commit details">
          {selected ? (
            <>
              <div className="git-commit-inspector-heading">
                <span>COMMIT DETAILS</span>
                <button
                  type="button"
                  className="git-icon-button"
                  aria-label="Close commit details"
                  onClick={() => setSelected(null)}
                >
                  <X />
                </button>
              </div>
              <div className="git-commit-inspector-content">
                <div className="git-commit-id">
                  <GitCommit />
                  <code>{selected.short_id}</code>
                  <button
                    type="button"
                    className="git-icon-button"
                    aria-label="Copy full commit SHA"
                    title="Copy full commit SHA"
                    onClick={(event) => void handleCopyId(selected.id, event)}
                  >{copied ? <Check /> : <Copy />}</button>
                </div>
                <h2>{selected.summary}</h2>
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
                  {selected.parents.length === 0 ? <p>Root commit</p> : selected.parents.map((parent) => <code key={parent}>{parent.slice(0, 12)}</code>)}
                </div>
                {cwd && <button
                  type="button"
                  className="git-control"
                  disabled={cherryPicking}
                  title="Cherry-pick this commit into the current branch"
                  onClick={() => void handleCherryPick(selected.id)}
                >{cherryPicking ? <Loader2 className="animate-spin" /> : <GitCommit />}Cherry-pick commit</button>}
                <p className="git-commit-action-hint">Apply this commit’s changes to your current branch.</p>
              </div>
            </>
          ) : <div className="git-maintenance-empty">
            <GitCommit />
            <strong>Inspect a commit</strong>
            <p>Select a row to see its author, parents and available actions.</p>
          </div>}
        </aside>
      </div>
      <footer className="git-history-footer">
        <span>{commits.length} commits loaded{query ? ` · ${matching.length} matching` : ''}</span>
        <span><GitMerge />Merge commit</span>
        <span>Newest first</span>
      </footer>
    </section>
  )
}
