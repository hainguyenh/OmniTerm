import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GitBranch,
  GitCommit,
  GitGraph,
  GitMerge,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitCommitInspector } from './GitCommitInspector'
import { GitGraphLanes } from './GitGraphLanes'
import { layoutGraph } from './gitGraphLayout'
import { usePaneSplit } from './usePaneSplit'
import './git-graph.css'
import type { GitBranchInfo, GitCommitDetails, GitCommitSummary } from './gitTypes'

interface GitGraphSectionProps {
  cwd?: string
  commits: GitCommitSummary[]
  loading: boolean
  onRefresh: () => void
  onSelectCommit?: (commit: GitCommitSummary) => void
  initialBranch?: string
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
  initialBranch = 'all',
}) => {
  const [selected, setSelected] = useState<GitCommitSummary | null>(null)
  const [search, setSearch] = useState('')
  const [filterBranch, setFilterBranch] = useState(initialBranch)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [activeCommits, setActiveCommits] = useState<GitCommitSummary[]>(commits)
  const [internalLoading, setInternalLoading] = useState(false)
  const [cherryPicking, setCherryPicking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [details, setDetails] = useState<GitCommitDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const api = useMemo(() => createGitAPI(), [])
  const bodyRef = useRef<HTMLDivElement>(null)

  const split = usePaneSplit({
    storageKey: 'omniterm:git-graph-inspector-width',
    defaultValue: 520,
    bounds: () => ({
      min: 300,
      max: Math.max(300, (bodyRef.current?.clientWidth ?? 900) - 280),
    }),
    unitsPerPixel: () => -1,
    step: 24,
  })

  // Synchronize commits prop if filter is at default and no branch switch made
  useEffect(() => {
    if (commits.length > 0 && filterBranch === 'all') {
      setActiveCommits(commits)
    }
  }, [commits, filterBranch])

  const loadBranches = useCallback(async () => {
    if (!cwd) return
    try {
      const list = await api.getBranches(cwd)
      if (Array.isArray(list)) {
        setBranches(list)
      }
    } catch {
      // branches query unavailable
    }
  }, [cwd, api])

  const loadGraphCommits = useCallback(
    async (branch: string) => {
      if (!cwd) return
      setInternalLoading(true)
      try {
        const branchArg = branch === 'all' ? '--all' : branch
        const res = await api.getLog(cwd, 150, branchArg)
        if (Array.isArray(res)) {
          setActiveCommits(res)
        }
      } catch (err: unknown) {
        setNotice(`Failed to load commits: ${String(err)}`)
      } finally {
        setInternalLoading(false)
      }
    },
    [cwd, api],
  )

  const handleBranchChange = (nextBranch: string) => {
    setFilterBranch(nextBranch)
    void loadGraphCommits(nextBranch)
  }

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

  const handleRefresh = () => {
    onRefresh()
    void loadBranches()
    void loadGraphCommits(filterBranch)
  }

  // Load commit point details when selection changes
  useEffect(() => {
    if (!selected || !cwd) {
      setDetails(null)
      return
    }
    let active = true
    setLoadingDetails(true)
    try {
      const promise =
        typeof api?.getCommitDetails === 'function'
          ? api.getCommitDetails(cwd, selected.id)
          : null
      if (promise && typeof promise.then === 'function') {
        promise
          .then((res) => {
            if (active && res && typeof res === 'object') setDetails(res)
          })
          .catch(() => {
            if (active) setDetails(null)
          })
          .finally(() => {
            if (active) setLoadingDetails(false)
          })
      } else {
        setLoadingDetails(false)
      }
    } catch {
      setLoadingDetails(false)
    }
    return () => {
      active = false
    }
  }, [selected?.id, cwd, api])

  const displayCommits = activeCommits.length > 0 ? activeCommits : commits
  const graph = useMemo(() => layoutGraph(displayCommits), [displayCommits])
  const query = search.trim().toLowerCase()
  const matching = displayCommits.filter((commit) =>
    `${commit.summary} ${commit.author_name} ${commit.id}`.toLowerCase().includes(query),
  )

  const handleSelect = (commit: GitCommitSummary) => {
    setSelected(commit.id === selected?.id ? null : commit)
    onSelectCommit?.(commit)
  }

  const isSpinning = loading || internalLoading

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

        {/* ── Branch Filter ────────────────────────────────────────────── */}
        <div className="git-graph-branch-filter" title="Filter commits by branch or show all">
          <GitBranch className="w-3.5 h-3.5 text-theme-dim shrink-0" />
          <select
            value={filterBranch}
            onFocus={() => void loadBranches()}
            onClick={() => void loadBranches()}
            onChange={(e) => handleBranchChange(e.target.value)}
            className="git-graph-branch-select"
            aria-label="Filter graph by branch"
          >
            <option value="all">All Branches (--all)</option>
            {Array.isArray(branches) && branches.length > 0 && (
              <optgroup label="Branches">
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.is_current ? ' (HEAD)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
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
          onClick={handleRefresh}
          disabled={isSpinning}
          className="git-control"
          aria-label="Refresh commit history"
        >
          <RefreshCw className={isSpinning ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {notice && (
        <div className="git-history-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="git-icon-button"
            aria-label="Dismiss commit notice"
            onClick={() => setNotice(null)}
          >
            <X />
          </button>
        </div>
      )}

      {/* ── Resizable 2-Panel Layout: Graph/Table (Left) + Inspector (Right) ── */}
      <div
        ref={bodyRef}
        className={`git-history-body ${split.dragging ? 'is-resizing' : ''}`}
      >
        <div className="git-history-scroll">
          <div
            className="git-history-table"
            style={{ '--graph-width': `${graph.width}px` } as React.CSSProperties}
          >
            <div className="git-history-columns">
              <span>TREE</span>
              <span>COMMIT</span>
              <span>AUTHOR</span>
              <span>WHEN</span>
              <span>SHA</span>
            </div>
            <div className="git-history-entries">
              {displayCommits.length > 0 && matching.length > 0 && (
                <div className="git-history-graph" aria-hidden="true">
                  <GitGraphLanes
                    rows={graph.rows}
                    width={graph.width}
                    selectedIndex={displayCommits.findIndex((c) => c.id === selected?.id)}
                    merges={displayCommits.map((c) => c.parents.length > 1)}
                  />
                </div>
              )}
              {displayCommits.length === 0 ? (
                <div className="git-maintenance-empty">
                  <GitCommit />
                  <strong>{isSpinning ? 'Loading history…' : 'No commits found'}</strong>
                </div>
              ) : matching.length === 0 ? (
                <div className="git-maintenance-empty">
                  <Search />
                  <strong>No matching commits</strong>
                  <p>Try another message, author or SHA.</p>
                </div>
              ) : (
                displayCommits.map((commit, index) => {
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
                      <span className="git-history-author" title={commit.author_name}>
                        {commit.author_name}
                      </span>
                      <span className="git-history-time">
                        {formatRelativeTime(commit.timestamp)}
                      </span>
                      <span className="git-history-sha">{commit.short_id}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Vertical Resizer Between Graph Table and Details Inspector ── */}
        <div
          {...split.separatorProps}
          aria-label="Resize commit graph and details panes"
          className="git-pane-resizer"
          title="Drag to resize panes · double-click to reset"
        />

        <aside
          className={`git-commit-inspector ${selected ? '' : 'is-empty'}`}
          style={{ width: `${split.value}px`, flex: `0 0 ${split.value}px` }}
          aria-label="Commit details"
        >
          <GitCommitInspector
            cwd={cwd}
            selected={selected}
            details={details}
            loadingDetails={loadingDetails}
            cherryPicking={cherryPicking}
            onClose={() => setSelected(null)}
            onCherryPick={handleCherryPick}
            onOpenFileDiff={(filePath, commitId) => {
              window.dispatchEvent(
                new CustomEvent('omniterm:open-file-diff', {
                  detail: { path: filePath, targetBranch: commitId },
                }),
              )
            }}
          />
        </aside>
      </div>

      <footer className="git-history-footer">
        <span>
          {displayCommits.length} commits loaded
          {query ? ` · ${matching.length} matching` : ''}
        </span>
        <span>
          <GitMerge />
          Merge commit
        </span>
        <span>Newest first</span>
      </footer>
    </section>
  )
}
