import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, CheckCircle2, Loader2, Search, ShieldCheck, Sparkles } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { analyzeBranchForCleanup } from './gitBranchCleanupUtils'
import { GitBranchCleanupDetail } from './GitBranchCleanupDetail'
import { GitBranchCleanupList } from './GitBranchCleanupList'
import { GitBranchDeleteConfirmDialog } from './GitBranchDeleteConfirmDialog'
import './git-maintenance.css'
import type { GitBranchInfo } from './gitTypes'

interface GitBranchCleanupModalProps {
  cwd: string
  currentBranch?: string
  branches: GitBranchInfo[]
  onClose: () => void
  onRefreshBranches: () => Promise<void>
}

type FilterTab = 'all' | 'recommended' | 'gone' | 'merged' | 'stale'

export const GitBranchCleanupModal: React.FC<GitBranchCleanupModalProps> = ({
  cwd,
  currentBranch,
  branches,
  onClose,
  onRefreshBranches,
}) => {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('recommended')
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set())
  const [inspectingBranchName, setInspectingBranchName] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [forceDelete, setForceDelete] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [notice, setNotice] = useState<{ message: string; isError?: boolean } | null>(null)

  const defaultBranch = useMemo(() => {
    const names = branches.map((b) => b.name)
    if (names.includes('master')) return 'master'
    if (names.includes('main')) return 'main'
    return currentBranch ?? 'HEAD'
  }, [branches, currentBranch])

  const localAnalyses = useMemo(() => {
    return branches
      .filter((b) => !b.is_remote)
      .map((b) => analyzeBranchForCleanup(b, currentBranch))
  }, [branches, currentBranch])

  const candidateCount = useMemo(
    () => localAnalyses.filter((a) => a.isCandidate && !a.isProtected).length,
    [localAnalyses],
  )
  const goneCount = useMemo(
    () => localAnalyses.filter((a) => a.branch.is_gone && !a.isProtected).length,
    [localAnalyses],
  )
  const mergedCount = useMemo(
    () => localAnalyses.filter((a) => a.branch.is_merged && !a.isProtected).length,
    [localAnalyses],
  )
  const staleCount = useMemo(
    () =>
      localAnalyses.filter(
        (a) => a.daysOld !== null && a.daysOld >= 30 && !a.isProtected,
      ).length,
    [localAnalyses],
  )

  const filteredAnalyses = useMemo(() => {
    const q = search.trim().toLowerCase()
    return localAnalyses.filter((a) => {
      // Tab filter
      if (activeFilter === 'recommended' && (!a.isCandidate || a.isProtected)) return false
      if (activeFilter === 'gone' && (!a.branch.is_gone || a.isProtected)) return false
      if (activeFilter === 'merged' && (!a.branch.is_merged || a.isProtected)) return false
      if (
        activeFilter === 'stale' &&
        (a.daysOld === null || a.daysOld < 30 || a.isProtected)
      ) {
        return false
      }

      // Search query
      if (q) {
        const matchesName = a.branch.name.toLowerCase().includes(q)
        const matchesAuthor = a.branch.last_commit_author?.toLowerCase().includes(q)
        const matchesMsg = a.branch.last_commit_message?.toLowerCase().includes(q)
        if (!matchesName && !matchesAuthor && !matchesMsg) return false
      }

      return true
    })
  }, [localAnalyses, activeFilter, search])

  const activeInspecting = useMemo(() => {
    if (inspectingBranchName) {
      const found = localAnalyses.find((a) => a.branch.name === inspectingBranchName)
      if (found) return found
    }
    return filteredAnalyses[0] ?? localAnalyses[0] ?? null
  }, [inspectingBranchName, localAnalyses, filteredAnalyses])

  const toggleSelect = (name: string) => {
    setSelectedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const selectAllRecommended = () => {
    const names = localAnalyses
      .filter((a) => a.isCandidate && !a.isProtected)
      .map((a) => a.branch.name)
    setSelectedBranches(new Set(names))
  }

  const selectAllShown = () => {
    const names = filteredAnalyses.filter((a) => !a.isProtected).map((a) => a.branch.name)
    setSelectedBranches((prev) => new Set([...prev, ...names]))
  }

  const deselectAll = () => {
    setSelectedBranches(new Set())
  }

  const handleFetchPrune = async () => {
    setIsFetching(true)
    setNotice(null)
    const api = createGitAPI()
    try {
      await api.fetch(cwd, true)
      await onRefreshBranches()
      setNotice({ message: 'Remotes fetched and pruned successfully.' })
    } catch (err) {
      setNotice({
        message: typeof err === 'string' ? err : 'Failed to fetch remotes',
        isError: true,
      })
    } finally {
      setIsFetching(false)
    }
  }

  const handleExecuteDelete = async (targets: string[]) => {
    if (targets.length === 0) return
    setIsDeleting(true)
    setShowConfirm(false)
    setNotice(null)

    const api = createGitAPI()
    try {
      const result = await api.deleteBranches(cwd, targets, forceDelete)
      await onRefreshBranches()

      setSelectedBranches((prev) => {
        const next = new Set(prev)
        for (const d of result.deleted) next.delete(d)
        return next
      })

      if (result.failed.length === 0) {
        setNotice({
          message: `Deleted ${result.deleted.length} branch(es) successfully.`,
        })
      } else {
        setNotice({
          message: `Deleted ${result.deleted.length} branch(es). ${result.failed.length} failed: ${result.failed[0]?.reason}`,
          isError: true,
        })
      }
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setNotice({
        message: typeof err === 'string' ? err : 'Error deleting branches',
        isError: true,
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const filters: { value: FilterTab; label: string; count: number }[] = [
    { value: 'recommended', label: 'Recommended', count: candidateCount },
    { value: 'gone', label: 'Remote gone', count: goneCount },
    { value: 'merged', label: 'Merged', count: mergedCount },
    { value: 'stale', label: 'Inactive', count: staleCount },
    { value: 'all', label: 'All local', count: localAnalyses.length },
  ]

  return (
    <section className="git-maintenance git-menu" aria-label="Local Branch Cleanup & Prune">
      <header className="git-maintenance-heading">
        <div className="git-section-title">
          <Sparkles />
          <div>
            <h1>Branch Cleanup & Prune</h1>
            <p>Find obsolete branches. Inspect their work. Review your cleanup plan.</p>
          </div>
        </div>
        <button type="button" className="git-control" onClick={onClose}><ArrowLeft />Changes</button>
      </header>
      <div className="git-maintenance-summary">
        <div>
          <Sparkles />
          <strong>{candidateCount}</strong>
          <span>Cleanup candidates</span>
        </div>
        <div>
          <CheckCircle2 />
          <strong>{mergedCount}</strong>
          <span>Already merged</span>
        </div>
        <div>
          <ShieldCheck />
          <strong>{localAnalyses.filter((analysis) => analysis.isProtected).length}</strong>
          <span>Protected branches</span>
        </div>
        <div className="git-prune-action">
          <button
            type="button"
            className="git-control"
            disabled={isFetching || isDeleting}
            onClick={() => void handleFetchPrune()}
          >
            <ArrowDownToLine className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Fetching…' : 'Fetch & Prune'}
          </button>
          <small>Refresh remotes and remove stale tracking references</small>
        </div>
      </div>
      {notice && <div className={`git-maintenance-notice ${notice.isError ? 'is-error' : ''}`} role={notice.isError ? 'alert' : 'status'}>{notice.message}</div>}
      <div className="git-maintenance-filters">
        <label className="git-search">
          <Search className="w-4 h-4 text-theme-dim" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search branches, authors, commits…"
            aria-label="Search cleanup branches"
          />
        </label>
        <div className="git-maintenance-tabs" role="group" aria-label="Branch filter">
          {filters.map((filter) => <button
            key={filter.value}
            type="button"
            aria-pressed={activeFilter === filter.value}
            onClick={() => setActiveFilter(filter.value)}
          >
            {filter.label}
            <span>{filter.count}</span>
          </button>)}
        </div>
      </div>
      <div className="git-maintenance-body">
        <GitBranchCleanupList
          analyses={filteredAnalyses}
          selected={selectedBranches}
          inspecting={activeInspecting?.branch.name}
          onSelect={toggleSelect}
          onInspect={setInspectingBranchName}
        />
        <div className="git-maintenance-viewer">
          {showConfirm ? (
            <GitBranchDeleteConfirmDialog
              open={showConfirm}
              selectedBranches={Array.from(selectedBranches)}
              forceDelete={forceDelete}
              busy={isDeleting}
              onForceDeleteChange={setForceDelete}
              onConfirm={() => void handleExecuteDelete(Array.from(selectedBranches))}
              onCancel={() => setShowConfirm(false)}
            />
          ) : activeInspecting ? (
            <GitBranchCleanupDetail
              cwd={cwd}
              branch={activeInspecting.branch}
              defaultBranch={defaultBranch}
              analysis={activeInspecting}
              deleting={isDeleting}
              onDeleteSingle={(name) => {
                setSelectedBranches(new Set([name]))
                setShowConfirm(true)
              }}
            />
          ) : <div className="git-maintenance-empty">
            <CheckCircle2 />
            <strong>Select a branch to inspect</strong>
            <p>Branch details and comparison appear here.</p>
          </div>}
        </div>
      </div>
      <footer className="git-maintenance-footer">
        <div className="git-maintenance-selection">
          <strong>{selectedBranches.size} selected</strong>
          <button type="button" onClick={selectAllRecommended}>Select recommended ({candidateCount})</button>
          <button type="button" onClick={selectAllShown}>Select shown</button>
          {selectedBranches.size > 0 && <button type="button" onClick={deselectAll}>Clear</button>}
        </div>
        <button
          type="button"
          className="git-control git-primary"
          disabled={selectedBranches.size === 0 || isDeleting}
          onClick={() => setShowConfirm(true)}
        >{isDeleting ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Review cleanup ({selectedBranches.size})</button>
      </footer>
    </section>
  )
}
