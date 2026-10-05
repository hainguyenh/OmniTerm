import { ArrowDownLeft, ArrowDownToLine, ArrowUpRight, ChevronDown, ChevronRight, FolderGit2, GitBranch, Loader2, Maximize2, Plus, Radio, RotateCw, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { GitBranchContextMenu } from './GitBranchContextMenu'
import { GitBranchDeleteDialog } from './GitBranchDeleteDialog'
import { GitBranchDiffModal } from './GitBranchDiffModal'
import { GitBranchSubmenu } from './GitBranchSubmenu'
import { GitBranchTreeView } from './GitBranchTreeView'
import { GitResizeGrip } from './GitResizeGrip'
import { requestFileDiff } from './gitFileDiffRequest'
import type { MenuPoint } from './gitMenuPlacement'
import { computePopoverStyle, opensUpward, type AnchorRect } from './gitPopoverPlacement'
import { buildBranchTree } from './gitBranchTreeUtils'
import type { GitBranchInfo } from './gitTypes'
import { useGitBranchOps } from './useGitBranchOps'
import { useResizablePanel } from './useResizablePanel'
import './git-ui.css'
import './git-branches.css'

interface GitBranchQuickPopoverProps {
  cwd: string
  currentBranch?: string
  anchorRect?: AnchorRect | null
  onClose: () => void
  onExpand: () => void
  onBranchSwitched?: () => void
  onOpenFileDiff?: (filePath: string, targetBranch: string) => void
}

const QUICK_MIN_SIZE = { width: 280, height: 220 }

export function GitBranchQuickPopover({
  cwd,
  currentBranch,
  anchorRect,
  onClose,
  onExpand,
  onBranchSwitched,
  onOpenFileDiff,
}: GitBranchQuickPopoverProps) {
  const upward = opensUpward(anchorRect)
  // Footer and toolbar popovers grow in opposite directions, so each remembers its own size.
  const { panelRef: popoverRef, size, startResize, resizeWithKeyboard, resetSize } = useResizablePanel<HTMLDivElement>({
    storageKey: upward ? 'omniterm:git-branch-popover-size:up' : 'omniterm:git-branch-popover-size:down',
    minSize: QUICK_MIN_SIZE,
    growth: { x: 1, y: upward ? -1 : 1 },
  })
  const [search, setSearch] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<GitBranchInfo | null>(null)
  const [comparingBranch, setComparingBranch] = useState<string | null>(null)
  const [contextBranch, setContextBranch] = useState<{ branch: GitBranchInfo; point: MenuPoint } | null>(null)
  const [localOpen, setLocalOpen] = useState(true)
  const [remoteOpen, setRemoteOpen] = useState(true)

  const {
    branches, loading, busyAction, actionNotice, creatingBranch, setCreatingBranch,
    newBranchName, setNewBranchName, startPoint, setStartPoint, notRepo, loadBranches,
    handleUpdateProject, handleFetch, handlePush, handleCheckout, handleMerge, handleRebase,
    handleCreateBranch, handleInitRepo, handlePullBranch, handleDeleteBranch,
    pendingDelete, confirmDelete, cancelDelete,
  } = useGitBranchOps({ cwd, currentBranch, onClose, onBranchSwitched, onBranchDeleted: () => setSelectedBranch(null) })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    popoverRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    return () => previous?.focus()
  }, [])

  const query = search.toLowerCase().trim()
  const branchList = branches ?? []
  const localBranches = branchList.filter((branch) => !branch.is_remote && (!query || branch.name.toLowerCase().includes(query)))
  const remoteBranches = branchList.filter((branch) => branch.is_remote && (!query || branch.name.toLowerCase().includes(query)))
  const shownBranch = selectedBranch
    ? branchList.find((branch) => branch.name === selectedBranch.name && branch.is_remote === selectedBranch.is_remote) ?? null
    : branchList.find((branch) => branch.is_current || branch.name === currentBranch) ?? null
  const localNodes = buildBranchTree(localBranches)
  const remoteNodes = buildBranchTree(remoteBranches)
  const repoName = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

  const newBranchFrom = (name: string) => {
    setCreatingBranch(true)
    setStartPoint(name)
  }

  const branchActions = {
    onCheckout: handleCheckout,
    onPull: handlePullBranch,
    onMerge: handleMerge,
    onRebase: handleRebase,
    onCompare: setComparingBranch,
    onNewBranchFrom: newBranchFrom,
    onDelete: (name: string) => void handleDeleteBranch(name),
  }

  const openContext = (branch: GitBranchInfo, point: MenuPoint) => {
    setSelectedBranch(branch)
    setContextBranch({ branch, point })
  }

  const closeContext = () => {
    setContextBranch(null)
  }

  const popoverStyle = computePopoverStyle(anchorRect, size)

  const content = (
    <div
      className="fixed inset-0 z-[9998] bg-transparent"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={popoverRef}
        style={popoverStyle}
        className="git-menu flex flex-col bg-[var(--theme-bg)] text-[var(--theme-fg)] border border-[var(--theme-border)] rounded-lg shadow-2xl overflow-hidden text-xs select-none"
        role="dialog"
        aria-modal="true"
        aria-label="Git Branches Quick View"
        data-testid="branch-quick-popover"
        onKeyDown={(e) => {
          if (comparingBranch || pendingDelete) return
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (contextBranch) closeContext()
            else if (creatingBranch) setCreatingBranch(false)
            else onClose()
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-1.5 px-3 py-2 bg-[var(--theme-sidebar-bg)] border-b border-[var(--theme-border)]">
          <div className="flex items-center gap-1.5 min-w-0 font-medium text-xs">
            <GitBranch className="w-4 h-4 text-[var(--theme-accent)] flex-shrink-0" />
            <span className="truncate" title={cwd}>{repoName}</span>
            <span className="truncate text-[10px] text-[var(--theme-dim)]" title={currentBranch ?? 'HEAD'}>({currentBranch ?? 'HEAD'})</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              disabled={loading || !!busyAction}
              onClick={() => void loadBranches()}
              aria-label="Refresh branches"
              title="Refresh branches"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              disabled={!!busyAction}
              onClick={() => void handleFetch()}
              aria-label="Fetch remotes"
              title="Fetch remotes"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              onClick={() => {
                onClose()
                onExpand()
              }}
              aria-label="Open full branch manager"
              title="Expand full manager"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Working branch bar */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--theme-bg)] border-b border-[var(--theme-border)] text-[11px] text-[var(--theme-dim)]">
          <Radio className="w-3 h-3 text-[var(--theme-accent)] flex-shrink-0" />
          <span className="truncate" title={currentBranch ?? 'HEAD'}>Working on <strong className="text-[var(--theme-fg)]">{currentBranch ?? 'HEAD'}</strong></span>
        </div>

        {/* Search & Actions */}
        <div className="p-2 border-b border-[var(--theme-border)] flex items-center gap-1.5">
          <div className="flex-1 relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2 text-[var(--theme-dim)] pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setLocalOpen(true)
                setRemoteOpen(true)
              }}
              placeholder="Find branch…"
              aria-label="Search branches"
              className="w-full pl-7 pr-2 py-1 text-xs bg-[var(--theme-input-bg,var(--theme-bg))] text-[var(--theme-fg)] border border-[var(--theme-border)] rounded outline-none focus:border-[var(--theme-accent)]"
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--theme-accent)] text-white hover:opacity-90 flex-shrink-0"
            disabled={notRepo || !!busyAction}
            onClick={() => newBranchFrom(currentBranch ?? 'HEAD')}
            title="Create new branch"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {actionNotice && (
          <div className={`px-2.5 py-1 text-[11px] ${actionNotice.isError ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10'}`} role="status">
            {actionNotice.text}
          </div>
        )}
        {busyAction && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-[var(--theme-dim)] bg-[var(--theme-hover-bg)]" role="status">
            <Loader2 className="w-3 h-3 animate-spin text-[var(--theme-accent)]" />
            <span>{busyAction}</span>
          </div>
        )}

        {creatingBranch && (
          <form className="p-2 border-b border-[var(--theme-border)] flex flex-col gap-1.5 bg-[var(--theme-hover-bg)]" onSubmit={handleCreateBranch}>
            <div className="text-[11px] text-[var(--theme-dim)]">Create branch from <strong>{startPoint ?? 'HEAD'}</strong>:</div>
            <input
              autoFocus
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="branch-name"
              className="px-2 py-1 text-xs bg-[var(--theme-bg)] text-[var(--theme-fg)] border border-[var(--theme-border)] rounded outline-none"
            />
            <div className="flex items-center gap-1.5 justify-end">
              <button type="button" className="px-2 py-0.5 text-xs rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)]" onClick={() => setCreatingBranch(false)}>Cancel</button>
              <button type="submit" className="px-2 py-0.5 text-xs rounded bg-[var(--theme-accent)] text-white font-medium" disabled={!newBranchName.trim() || !!busyAction}>Create</button>
            </div>
          </form>
        )}

        {/* Tree Content */}
        {notRepo ? (
          <div className="p-4 text-center text-[var(--theme-dim)] flex flex-col items-center gap-2">
            <FolderGit2 className="w-6 h-6 opacity-60" />
            <p>Not a Git repository</p>
            <button type="button" className="px-2.5 py-1 text-xs rounded bg-[var(--theme-accent)] text-white" disabled={!!busyAction} onClick={() => void handleInitRepo()}>Initialize repo</button>
          </div>
        ) : (
          <div className={`flex-1 min-h-0 overflow-y-auto p-1 ${size ? '' : 'max-h-[300px]'}`}>
            {loading && branches.length === 0 ? (
              <div className="flex items-center justify-center p-4 gap-2 text-[var(--theme-dim)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading branches…</span>
              </div>
            ) : localBranches.length + remoteBranches.length === 0 ? (
              <div className="p-4 text-center text-[var(--theme-dim)]">
                {query ? 'No matching branches' : 'No branches yet'}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="w-full flex items-center gap-1 px-1.5 py-1 text-[11px] font-semibold text-[var(--theme-dim)] hover:text-[var(--theme-fg)]"
                  aria-expanded={localOpen}
                  onClick={() => setLocalOpen((open) => !open)}
                >
                  {localOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <span>Local branches</span>
                  <small className="ml-auto opacity-70">{localBranches.length}</small>
                </button>
                {localOpen && (
                  <GitBranchTreeView
                    nodes={localNodes}
                    currentBranch={currentBranch}
                    selectedBranch={shownBranch}
                    onSelectBranch={setSelectedBranch}
                    onContextBranch={openContext}
                  />
                )}
                {remoteBranches.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="w-full flex items-center gap-1 px-1.5 py-1 text-[11px] font-semibold text-[var(--theme-dim)] hover:text-[var(--theme-fg)] mt-1"
                      aria-expanded={remoteOpen}
                      onClick={() => setRemoteOpen((open) => !open)}
                    >
                      {remoteOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>Remote branches</span>
                      <small className="ml-auto opacity-70">{remoteBranches.length}</small>
                    </button>
                    {remoteOpen && (
                      <GitBranchTreeView
                        nodes={remoteNodes}
                        currentBranch={currentBranch}
                        selectedBranch={shownBranch}
                        onSelectBranch={setSelectedBranch}
                        onContextBranch={openContext}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-[var(--theme-sidebar-bg)] border-t border-[var(--theme-border)] text-[11px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              disabled={notRepo || !!busyAction}
              onClick={() => void handleUpdateProject()}
              title="Pull current branch"
            >
              <ArrowDownLeft className="w-3 h-3" />
              <span>Pull</span>
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              disabled={notRepo || !!busyAction}
              onClick={() => void handlePush()}
              title="Push current branch"
            >
              <ArrowUpRight className="w-3 h-3" />
              <span>Push</span>
            </button>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[var(--theme-accent)] hover:underline cursor-pointer"
            onClick={() => {
              onClose()
              onExpand()
            }}
          >
            <span>Full manager…</span>
          </button>
        </div>

        <GitResizeGrip
          label="Resize branch popover"
          corner={upward ? 'top-right' : 'bottom-right'}
          onResizeStart={startResize}
          onResizeKey={resizeWithKeyboard}
          onReset={resetSize}
        />

        {/* Context Menu */}
        {contextBranch && (
          <GitBranchContextMenu
            title={contextBranch.branch.name}
            point={contextBranch.point}
            containerRef={popoverRef}
            onClose={closeContext}
          >
            <fieldset disabled={!!busyAction}>
              <GitBranchSubmenu
                branch={contextBranch.branch}
                currentBranch={currentBranch}
                inline
                compact
                {...branchActions}
                onClose={closeContext}
              />
            </fieldset>
          </GitBranchContextMenu>
        )}

        {pendingDelete && (
          <GitBranchDeleteDialog
            pending={pendingDelete}
            busy={!!busyAction}
            onConfirm={confirmDelete}
            onClose={cancelDelete}
          />
        )}
      </div>

      {comparingBranch && (
        <GitBranchDiffModal
          cwd={cwd}
          currentBranch={currentBranch ?? 'HEAD'}
          targetBranch={comparingBranch}
          onClose={() => setComparingBranch(null)}
          onOpenFileDiff={(path, branch) => {
            setComparingBranch(null)
            onClose()
            if (onOpenFileDiff) onOpenFileDiff(path, branch)
            else requestFileDiff({ path, targetBranch: branch })
          }}
        />
      )}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}
