import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  GitBranch,
  GitCommit,
  GitCompare,
  Loader2,
  X,
} from 'lucide-react'
import { createGitAPI } from '../../gitAPI'
import { Tooltip } from '../Tooltip'
import { GitBranchDiffFileTree } from './GitBranchDiffFileTree'
import type { GitBranchComparison } from './gitTypes'

interface GitBranchDiffModalProps {
  cwd: string
  currentBranch: string
  targetBranch: string
  onClose: () => void
  onOpenFileDiff: (filePath: string, targetBranch: string) => void
}

export const GitBranchDiffModal: React.FC<GitBranchDiffModalProps> = ({
  cwd,
  currentBranch: initialBase,
  targetBranch: initialTarget,
  onClose,
  onOpenFileDiff,
}) => {
  const [baseBranch, setBaseBranch] = useState(initialBase)
  const [targetBranch, setTargetBranch] = useState(initialTarget)
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'files' | 'commits'>('files')
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [cherryPicking, setCherryPicking] = useState<string | null>(null)

  const api = createGitAPI()

  const loadComparison = async (base: string, target: string) => {
    setLoading(true)
    setActionNotice(null)
    try {
      const res = await api.compareBranches(cwd, base, target)
      setComparison(res)
    } catch (err) {
      setActionNotice(`Comparison failed: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadComparison(baseBranch, targetBranch)
  }, [cwd, baseBranch, targetBranch])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSwap = () => {
    const nextBase = targetBranch
    const nextTarget = baseBranch
    setBaseBranch(nextBase)
    setTargetBranch(nextTarget)
  }

  const handleCherryPick = async (commitId: string) => {
    setCherryPicking(commitId)
    try {
      const res = await api.cherryPick(cwd, commitId)
      // Reload first: `loadComparison` clears the notice, so setting it before would wipe it.
      await loadComparison(baseBranch, targetBranch)
      setActionNotice(res || `Cherry-pick of ${commitId.slice(0, 7)} succeeded`)
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setActionNotice(`Cherry-pick failed: ${String(err)}`)
    } finally {
      setCherryPicking(null)
    }
  }

  // A file diff compares the working tree with a branch, so it must be the side that is not checked
  // out: after a swap the target is the current branch, and diffing against it would show nothing.
  const fileDiffBranch = targetBranch === initialBase ? baseBranch : targetBranch
  const files = comparison?.files ?? []
  const commitsAhead = comparison?.commits_ahead ?? []
  const commitsBehind = comparison?.commits_behind ?? []

  const content = (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${baseBranch} with ${targetBranch}`}
    >
      <div className="git-menu w-full max-w-2xl bg-theme-bg border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-theme-fg animate-in zoom-in-95 duration-150 max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-theme-sidebar flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare className="w-4 h-4 text-theme-accent flex-shrink-0" />
            <div className="flex items-center gap-1.5 font-mono text-xs truncate">
              <span className="font-semibold text-theme-fg">{baseBranch}</span>
              <button
                type="button"
                onClick={handleSwap}
                title="Swap branch comparison direction"
                className="p-1 rounded hover:bg-theme-bg text-theme-dim hover:text-theme-fg transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-theme-accent" />
              </button>
              <span className="font-semibold text-purple-400">{targetBranch}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 rounded hover:bg-theme-hover hover:text-theme-fg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice */}
        {actionNotice && (
          <div className="px-3 py-1.5 text-[11px] bg-theme-accent/10 border-b border-theme-accent/30 text-theme-accent truncate">
            {actionNotice}
          </div>
        )}

        {/* Tabs Bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-theme-border/60 bg-theme-sidebar/40">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('files')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'files'
                  ? 'bg-theme-accent text-white'
                  : 'text-theme-dim hover:text-theme-fg'
              }`}
            >
              Files Changed ({files.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('commits')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'commits'
                  ? 'bg-theme-accent text-white'
                  : 'text-theme-dim hover:text-theme-fg'
              }`}
            >
              Commits ({commitsAhead.length} ahead, {commitsBehind.length} behind)
            </button>
          </div>
          {comparison && (
            <div className="text-[11px] text-theme-dim font-mono">
              {files.length} file(s) changed
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-[220px] custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center p-12 gap-2 text-theme-dim">
              <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
              <span>Comparing branches...</span>
            </div>
          ) : activeTab === 'files' ? (
            files.length === 0 ? (
              <div className="p-12 text-center text-theme-dim">
                No differences found between {baseBranch} and {targetBranch}
              </div>
            ) : (
              <GitBranchDiffFileTree files={files} onOpenFile={(path) => onOpenFileDiff(path, fileDiffBranch)} />
            )
          ) : (
            <div className="p-3 flex flex-col gap-4">
              <div>
                <div className="text-[11px] font-semibold text-theme-dim uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <GitBranch className="w-3 h-3 text-purple-400" />
                  <span>Commits in {targetBranch} (not in {baseBranch}) — {commitsAhead.length}</span>
                </div>
                {commitsAhead.length === 0 ? (
                  <div className="text-theme-dim/60 text-[11px] px-2 py-1">No commits ahead</div>
                ) : (
                  <div className="divide-y divide-theme-border/30 border border-theme-border/40 rounded-lg overflow-hidden">
                    {commitsAhead.map((c) => (
                      <div
                        key={c.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-theme-hover/60 transition-colors gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-theme-accent font-semibold">
                              {c.short_id}
                            </span>
                            <span className="text-[11px] font-medium text-theme-fg truncate">
                              {c.summary}
                            </span>
                          </div>
                          <div className="text-[10px] text-theme-dim mt-0.5 truncate">
                            {c.author_name} · {new Date(c.timestamp * 1000).toLocaleDateString()}
                          </div>
                        </div>
                        <Tooltip content="Cherry-pick this commit into current branch">
                          <button
                            type="button"
                            onClick={() => handleCherryPick(c.id)}
                            disabled={cherryPicking === c.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-theme-border hover:border-theme-accent text-theme-fg text-[11px] transition-colors cursor-pointer flex-shrink-0"
                          >
                            {cherryPicking === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin text-theme-accent" />
                            ) : (
                              <GitCommit className="w-3 h-3 text-emerald-400" />
                            )}
                            <span>Cherry-pick</span>
                          </button>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {commitsBehind.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-theme-dim uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <GitBranch className="w-3 h-3 text-theme-accent" />
                    <span>Commits in {baseBranch} (not in {targetBranch}) — {commitsBehind.length}</span>
                  </div>
                  <div className="divide-y divide-theme-border/30 border border-theme-border/40 rounded-lg overflow-hidden">
                    {commitsBehind.map((c) => (
                      <div
                        key={c.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-theme-hover/60 transition-colors gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-theme-dim font-semibold">
                              {c.short_id}
                            </span>
                            <span className="text-[11px] font-medium text-theme-fg truncate">
                              {c.summary}
                            </span>
                          </div>
                          <div className="text-[10px] text-theme-dim mt-0.5 truncate">
                            {c.author_name} · {new Date(c.timestamp * 1000).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}
