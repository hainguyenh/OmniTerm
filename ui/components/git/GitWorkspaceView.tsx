import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Connection, Workspace } from '@omniterm/contract'
import { GitBranch } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitBranchMaintenance } from './GitBranchMaintenance'
import { GitBranchPopup } from './GitBranchPopup'
import { GitCommitSection } from './GitCommitSection'
import { takePendingFileDiff, type FileDiffRequest } from './gitFileDiffRequest'
import { GitDiffViewer } from './GitDiffViewer'
import { GitGraphSection } from './GitGraphSection'
import { GitWorkspaceToolbar } from './GitWorkspaceToolbar'
import type { GitCommitSummary, GitRepoStatus } from './gitTypes'
import { useGitProjects } from './useGitProjects'

interface GitWorkspaceViewProps {
  cwd?: string
  workspaces?: Workspace[]
  savedConnections?: Connection[]
  gitGraphEnabled?: boolean
  onClose: () => void
}

export const GitWorkspaceView: React.FC<GitWorkspaceViewProps> = ({
  cwd,
  workspaces = [],
  savedConnections = [],
  gitGraphEnabled = true,
  onClose,
}) => {
  const gitAPI = useRef(createGitAPI()).current
  const { projects, activePath, selectProject } = useGitProjects(workspaces, cwd, savedConnections)

  const [repoStatus, setRepoStatus] = useState<GitRepoStatus | null>(null)
  const [commits, setCommits] = useState<GitCommitSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchPopupOpen, setBranchPopupOpen] = useState(false)
  const [branchPopupAnchor, setBranchPopupAnchor] = useState<DOMRect | null>(null)
  const [syncing, setSyncing] = useState<'pull' | 'push' | 'fetch' | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'changes' | 'graph' | 'maintenance'>(() => {
    try {
      const stored = localStorage.getItem('omniterm:git-active-tab')
      return stored === 'maintenance' ? 'maintenance' : stored === 'graph' ? 'graph' : 'changes'
    } catch {
      return 'changes'
    }
  })

  const [diffTarget, setDiffTarget] = useState<{ path: string; staged: boolean; targetBranch?: string } | null>(null)
  const [leftWidth, setLeftWidth] = useState(380)
  const isResizingLeft = useRef(false)

  const effectiveCwd = activePath ?? cwd
  const currentTab = !gitGraphEnabled && activeTab === 'graph' ? 'changes' : activeTab

  const handleTabChange = (tab: 'changes' | 'graph' | 'maintenance') => {
    setActiveTab(tab)
    try {
      localStorage.setItem('omniterm:git-active-tab', tab)
    } catch {
      // storage unavailable
    }
  }

  const fetchGitData = useCallback(async () => {
    if (!effectiveCwd) {
      setRepoStatus(null)
      setCommits([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [statusRes, logRes] = await Promise.all([
        gitAPI.getStatus(effectiveCwd).catch((err: unknown) => {
          throw new Error(typeof err === 'string' ? err : 'Failed to query git status')
        }),
        gitAPI.getLog(effectiveCwd, 50).catch(() => [] as GitCommitSummary[]),
      ])
      setRepoStatus(statusRes)
      setCommits(logRes)

      if (statusRes.files.length > 0) {
        setDiffTarget((prev) => {
          if (prev && statusRes.files.some((f) => f.path === prev.path)) {
            return prev
          }
          const first = statusRes.files[0]
          return { path: first.path, staged: first.staged !== 'unmodified' }
        })
      } else {
        setDiffTarget(null)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setRepoStatus(null)
      setCommits([])
    } finally {
      setLoading(false)
    }
  }, [effectiveCwd, gitAPI])

  useEffect(() => {
    void fetchGitData()
  }, [fetchGitData])

  useEffect(() => {
    const handleRefresh = () => {
      void fetchGitData()
    }
    const showFileDiff = (request: FileDiffRequest | null | undefined) => {
      if (!request?.path) return
      setActiveTab('changes')
      setDiffTarget({
        path: request.path,
        staged: false,
        targetBranch: request.targetBranch,
      })
    }
    const handleOpenFileDiff = (e: Event) => {
      takePendingFileDiff()
      showFileDiff((e as CustomEvent<FileDiffRequest>).detail)
    }
    // A diff requested while this view was closed (see requestFileDiff).
    showFileDiff(takePendingFileDiff())
    const handleMaintenance = () => {
      setBranchPopupOpen(false)
      setActiveTab('maintenance')
    }
    window.addEventListener('omniterm:open-git-maintenance', handleMaintenance)
    window.addEventListener('omniterm:git-refresh', handleRefresh)
    window.addEventListener('omniterm:open-file-diff', handleOpenFileDiff)
    return () => {
      window.removeEventListener('omniterm:open-git-maintenance', handleMaintenance)
      window.removeEventListener('omniterm:git-refresh', handleRefresh)
      window.removeEventListener('omniterm:open-file-diff', handleOpenFileDiff)
    }
  }, [fetchGitData])

  const handleCommit = async (message: string, amend: boolean) => {
    if (!effectiveCwd) return
    await gitAPI.commit(effectiveCwd, message, amend)
    await fetchGitData()
    window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
  }

  const handleRevert = async (paths: string[]) => {
    if (!effectiveCwd) return
    await gitAPI.revert(effectiveCwd, paths)
    await fetchGitData()
    window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
  }

  const handleSyncAction = async (action: 'pull' | 'push' | 'fetch') => {
    if (!effectiveCwd || syncing) return
    setSyncing(action)
    setSyncNotice(null)
    try {
      let res = ''
      if (action === 'fetch') {
        res = await gitAPI.fetch(effectiveCwd)
      } else if (action === 'pull') {
        res = await gitAPI.pull(effectiveCwd, false)
      } else {
        res = await gitAPI.push(effectiveCwd)
      }
      setSyncNotice(res || `${action} completed`)
      await fetchGitData()
    } catch (err: unknown) {
      setSyncNotice(`${action} failed: ${String(err)}`)
    } finally {
      setSyncing(null)
      setTimeout(() => setSyncNotice(null), 4000)
    }
  }

  const startResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizingLeft.current = true
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingLeft.current) return
      setLeftWidth(Math.max(260, Math.min(ev.clientX - 48, 700)))
    }
    const onMouseUp = () => {
      isResizingLeft.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const allChangedFiles = useMemo(() => {
    if (!repoStatus) return []
    const list: Array<{ path: string; staged: boolean }> = []
    for (const f of repoStatus.files) {
      if (f.staged !== 'unmodified') {
        list.push({ path: f.path, staged: true })
      }
      if (f.unstaged !== 'unmodified') {
        list.push({ path: f.path, staged: false })
      }
    }
    return list
  }, [repoStatus])

  return (
    <div className="git-workspace h-full w-full flex flex-col bg-theme-bg overflow-hidden select-none">
      <GitWorkspaceToolbar
        projects={projects}
        selectedPath={effectiveCwd ?? null}
        currentBranch={repoStatus?.branch ?? undefined}
        isNotGit={Boolean(effectiveCwd && repoStatus === null && !loading)}
        repoStatus={repoStatus}
        syncing={syncing}
        syncNotice={syncNotice}
        activeTab={currentTab}
        showGraphTab={gitGraphEnabled}
        onSelectProject={selectProject}
        onToggleBranchPopup={(rect) => {
          setBranchPopupAnchor(rect ?? null)
          setBranchPopupOpen(true)
        }}
        onSyncAction={handleSyncAction}
        onChangeTab={handleTabChange}
        onClose={onClose}
      />

      {branchPopupOpen && effectiveCwd && (
        <GitBranchPopup
          cwd={effectiveCwd}
          currentBranch={repoStatus?.branch ?? undefined}
          anchorRect={branchPopupAnchor}
          onClose={() => setBranchPopupOpen(false)}
          onOpenFileDiff={(path, targetBranch) => {
            setActiveTab('changes')
            setDiffTarget({ path, staged: false, targetBranch })
          }}
          onBranchSwitched={() => {
            void fetchGitData()
            window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
          }}
        />
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-theme-bg">
            <GitBranch className="w-10 h-10 mb-3 text-amber-400 opacity-60" />
            <p className="font-semibold text-sm text-theme-fg mb-1">Cannot Read Git Repository</p>
            <p className="text-xs text-theme-dim max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchGitData}
              className="px-3 py-1.5 text-xs rounded bg-theme-accent text-white font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              Retry Detection
            </button>
          </div>
        )}

        {/* ── DEFAULT 2-PANEL LAYOUT: Local Changes (Left) + Diff View (Right) ── */}
        {currentTab === 'changes' && (
          <div className="git-changes-layout flex-1 flex min-h-0">
            <div
              style={{ '--git-changes-width': `${leftWidth}px` } as React.CSSProperties}
              className="git-changes-pane flex flex-col flex-shrink-0 min-w-[260px] overflow-hidden border-r border-theme-border"
            >
              <GitCommitSection
                status={repoStatus}
                loading={loading}
                selectedFile={diffTarget?.path ?? null}
                cwd={effectiveCwd}
                currentBranch={repoStatus?.branch}
                onRefresh={fetchGitData}
                onSelectFile={(path, staged, targetBranch) =>
                  setDiffTarget({ path, staged, targetBranch })
                }
                onCommit={handleCommit}
                onRevert={handleRevert}
              />
            </div>

            <div
              onMouseDown={startResizeLeft}
              className="git-pane-resizer w-1.5 flex-shrink-0 cursor-col-resize hover:bg-theme-accent transition-colors bg-theme-border/30 active:bg-theme-accent z-10"
              title="Drag to resize panes"
            />

            <div className="git-diff-pane flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-theme-bg">
              {diffTarget && effectiveCwd ? (
                <GitDiffViewer
                  cwd={effectiveCwd}
                  filePath={diffTarget.path}
                  staged={diffTarget.staged}
                  targetBranch={diffTarget.targetBranch}
                  inline
                  allFiles={allChangedFiles}
                  onSelectFile={(path, staged) => setDiffTarget({ path, staged })}
                  onClose={() => setDiffTarget(null)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-theme-dim">
                  <p className="font-semibold text-xs text-theme-fg mb-1">Diff Viewer</p>
                  <p className="text-xs">Select any modified or staged file on the left to inspect its diff.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {currentTab === 'maintenance' && (effectiveCwd ? (
          <GitBranchMaintenance key={effectiveCwd} cwd={effectiveCwd} currentBranch={repoStatus?.branch} onClose={() => handleTabChange('changes')} />
        ) : <div className="git-maintenance-empty"><GitBranch /><p>Select a repository to manage branches.</p></div>)}

        {/* ── GIT GRAPH PARTITION ── */}
        {currentTab === 'graph' && (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-theme-sidebar">
            <GitGraphSection
              cwd={effectiveCwd}
              commits={commits}
              loading={loading}
              onRefresh={fetchGitData}
            />
          </div>
        )}
      </div>
    </div>
  )
}
