import { ArrowDownLeft, ArrowDownToLine, ArrowUpRight, ChevronsDownUp, ChevronsUpDown, ChevronDown, ChevronRight, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal, List, Loader2, Plus, Radio, RotateCw, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GitBranchContextMenu } from './GitBranchContextMenu'
import { GitBranchDeleteDialog } from './GitBranchDeleteDialog'
import { GitBranchDiffModal } from './GitBranchDiffModal'
import { GitBranchInspector } from './GitBranchInspector'
import { GitBranchSubmenu } from './GitBranchSubmenu'
import { GitBranchTreeView } from './GitBranchTreeView'
import { GitResizeGrip } from './GitResizeGrip'
import { requestFileDiff } from './gitFileDiffRequest'
import type { MenuPoint } from './gitMenuPlacement'
import type { AnchorRect } from './gitPopoverPlacement'
import { buildBranchTree, type GitBranchTreeNode } from './gitBranchTreeUtils'
import type { GitBranchInfo } from './gitTypes'
import { useGitBranchOps } from './useGitBranchOps'
import { useResizablePanel } from './useResizablePanel'
import './git-ui.css'
import './git-branches.css'

interface GitBranchPopupProps {
  cwd: string
  currentBranch?: string
  anchorRect?: AnchorRect | null
  onClose: () => void
  onOpenCommit?: () => void
  onBranchSwitched?: () => void
  onOpenFileDiff?: (filePath: string, targetBranch: string) => void
}

const DIALOG_MIN_SIZE = { width: 520, height: 400 }

export function GitBranchPopup({ cwd, currentBranch, onClose, onOpenCommit, onBranchSwitched, onOpenFileDiff }: GitBranchPopupProps) {
  // The dialog is centered, so it grows on both sides of the grip.
  const { panelRef: popupRef, size, startResize, resizeWithKeyboard, resetSize } = useResizablePanel<HTMLDivElement>({
    storageKey: 'omniterm:git-branch-dialog-size',
    minSize: DIALOG_MIN_SIZE,
    growth: { x: 2, y: 2 },
  })
  const contextReturnFocus = useRef<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<GitBranchInfo | null>(null)
  const [comparingBranch, setComparingBranch] = useState<string | null>(null)
  const [contextBranch, setContextBranch] = useState<{ branch: GitBranchInfo; point: MenuPoint } | null>(null)
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree')
  const [collapsed, setCollapsed] = useState(false)
  const [treeRevision, setTreeRevision] = useState(0)
  const [localOpen, setLocalOpen] = useState(true)
  const [remoteOpen, setRemoteOpen] = useState(true)
  const {
    branches, loading, busyAction, actionNotice, creatingBranch, setCreatingBranch,
    newBranchName, setNewBranchName, startPoint, setStartPoint, notRepo, loadBranches,
    handleUpdateProject, handleFetch, handlePush, handleCheckout, handleMerge, handleRebase,
    handleCreateBranch, handleInitRepo, handlePullBranch, handleDeleteBranch, pendingDelete, confirmDelete, cancelDelete,
    handleRenameBranch, handleSetUpstream, handleAddWorktree,
  } = useGitBranchOps({ cwd, currentBranch, onClose, onBranchSwitched, onBranchDeleted: () => setSelectedBranch(null) })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    popupRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    return () => previous?.focus()
  }, [])

  const query = search.toLowerCase().trim()
  const localBranches = branches.filter((branch) => !branch.is_remote && (!query || branch.name.toLowerCase().includes(query)))
  const remoteBranches = branches.filter((branch) => branch.is_remote && (!query || branch.name.toLowerCase().includes(query)))
  const shownBranch = selectedBranch
    ? branches.find((branch) => branch.name === selectedBranch.name && branch.is_remote === selectedBranch.is_remote) ?? null
    : branches.find((branch) => branch.is_current || branch.name === currentBranch) ?? null
  const localNodes = nodesFor(localBranches, viewMode)
  const remoteNodes = nodesFor(remoteBranches, viewMode)
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
  const remoteNames = branches.filter((branch) => branch.is_remote).map((branch) => branch.name)
  const branchTools = {
    onRename: async (name: string, newName: string) => {
      const failure = await handleRenameBranch(name, newName)
      if (!failure) setSelectedBranch(null)
      return failure
    },
    onSetUpstream: handleSetUpstream,
    onAddWorktree: async (name: string) => {
      const failure = await handleAddWorktree(name)
      if (!failure) onClose()
      return failure
    },
  }
  const openContext = (branch: GitBranchInfo, point: MenuPoint) => {
    contextReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedBranch(branch)
    setContextBranch({ branch, point })
  }
  const closeContext = () => {
    setContextBranch(null)
    contextReturnFocus.current?.focus()
  }
  const toggleAll = (next: boolean) => {
    setCollapsed(next)
    setTreeRevision((value) => value + 1)
    setLocalOpen(true)
    setRemoteOpen(true)
  }

  const content = (
    <div className="git-branch-backdrop" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        ref={popupRef}
        className={`git-branches-dialog git-menu ${size ? 'is-resized' : ''}`}
        style={size ? { width: size.width, height: size.height } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Git Branches"
        aria-describedby="git-branches-description"
        onKeyDown={(event) => {
          if (comparingBranch || pendingDelete) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (contextBranch) closeContext()
            else if (creatingBranch) setCreatingBranch(false)
            else onClose()
          }
          if (event.key === 'Tab') {
            const focusScope = contextBranch ? popupRef.current?.querySelector('.git-branch-context') : popupRef.current
            const controls = Array.from(focusScope?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary, [tabindex="0"]') ?? []).filter((control) => control.getClientRects().length > 0)
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className="git-branches-heading">
          <div className="git-branches-heading-icon"><GitBranch /></div>
          <div><h1>Branches</h1><p id="git-branches-description">Explore, compare and manage your repository.</p></div>
          <span className="git-branches-repo" title={cwd}><FolderGit2 />{repoName}</span>
          <button type="button" className="git-icon-button" aria-label="Close branch menu" onClick={onClose}><X /></button>
        </header>
        <div className="git-branches-checkout"><Radio /><span title={currentBranch ?? 'HEAD'}>Working on <strong>{currentBranch ?? 'HEAD'}</strong></span><span>Checkout stays here until you switch branches.</span></div>
        <div className="git-branches-toolbar">
          <label className="git-search"><Search /><input type="search" value={search} onChange={(event) => {
            setSearch(event.target.value)
            setLocalOpen(true)
            setRemoteOpen(true)
          }} placeholder="Find a local or remote branch…" aria-label="Search branches" /></label>
          <button type="button" className="git-control" disabled={!!busyAction} onClick={() => void handleFetch()} aria-label="Fetch Remotes"><ArrowDownToLine />Fetch</button>
          <button type="button" className="git-icon-button" disabled={loading || !!busyAction} onClick={() => void loadBranches()} aria-label="Refresh Branches"><RotateCw className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="git-control git-primary" disabled={notRepo || !!busyAction} onClick={() => newBranchFrom(currentBranch ?? 'HEAD')}><Plus />New branch</button>
        </div>
        {actionNotice && <div className={`git-branches-notice ${actionNotice.isError ? 'is-error' : ''}`} role="status">{actionNotice.text}</div>}
        {busyAction && <div className="git-branches-notice" role="status"><Loader2 className="animate-spin" />{busyAction}</div>}
        {creatingBranch && <form className="git-branches-create" onSubmit={handleCreateBranch}>
          <label htmlFor="git-new-branch-name">Create from <strong>{startPoint ?? 'HEAD'}</strong><small>Creating a branch also checks it out.</small></label>
          <input id="git-new-branch-name" autoFocus value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="feature/branch-name" />
          <button type="submit" className="git-control git-primary" disabled={!newBranchName.trim() || !!busyAction}>Create & checkout</button>
          <button type="button" className="git-control" onClick={() => setCreatingBranch(false)}>Cancel</button>
        </form>}
        {notRepo ? <div className="git-branch-empty"><FolderGit2 /><h2>Not a Git repository</h2><p>This folder is not currently tracked by Git.</p><button type="button" className="git-control git-primary" disabled={!!busyAction} onClick={() => void handleInitRepo()}>Initialize repository</button></div> : (
          <div className="git-branches-body">
            <section className="git-branches-browser" aria-label="Branch browser">
              <div className="git-branches-browser-tools">
                <div role="group" aria-label="Branch view"><button type="button" aria-pressed={viewMode === 'tree'} onClick={() => setViewMode('tree')}><FolderTree />Tree</button><button type="button" aria-pressed={viewMode === 'flat'} onClick={() => setViewMode('flat')}><List />List</button></div>
                <button type="button" className="git-icon-button" disabled={viewMode === 'flat'} aria-label="Expand all branch folders" title="Expand all" onClick={() => toggleAll(false)}><ChevronsUpDown /></button>
                <button type="button" className="git-icon-button" disabled={viewMode === 'flat'} aria-label="Collapse all branch folders" title="Collapse all" onClick={() => toggleAll(true)}><ChevronsDownUp /></button>
              </div>
              <div className="git-branches-tree-scroll">
                {loading && branches.length === 0 ? <div className="git-branch-empty"><Loader2 className="animate-spin" /><p>Loading branches…</p></div> : localBranches.length + remoteBranches.length === 0 ? <div className="git-branch-empty"><Search /><h2>{query ? 'No matching branches' : 'No branches yet'}</h2><p>{query ? 'Try another name or clear your search.' : 'Create a branch after your first commit.'}</p></div> : <>
                  <button type="button" className="git-branch-group" aria-expanded={localOpen} onClick={() => setLocalOpen((open) => !open)}>{localOpen ? <ChevronDown /> : <ChevronRight />}<span>Local branches</span><small>{localBranches.length}</small></button>
                  {localOpen && <GitBranchTreeView key={`local-${treeRevision}-${query}`} nodes={localNodes} currentBranch={currentBranch} selectedBranch={shownBranch} collapsed={collapsed && !query} onSelectBranch={setSelectedBranch} onContextBranch={openContext} />}
                  {remoteBranches.length > 0 && <>
                    <button type="button" className="git-branch-group" aria-expanded={remoteOpen} onClick={() => setRemoteOpen((open) => !open)}>{remoteOpen ? <ChevronDown /> : <ChevronRight />}<span>Remote branches</span><small>{remoteBranches.length}</small></button>
                    {remoteOpen && <GitBranchTreeView key={`remote-${treeRevision}-${query}`} nodes={remoteNodes} currentBranch={currentBranch} selectedBranch={shownBranch} collapsed={collapsed && !query} onSelectBranch={setSelectedBranch} onContextBranch={openContext} />}
                  </>}
                </>}
              </div>
              <div className="git-branches-browser-hint">Select to inspect · Right-click or <kbd>Shift F10</kbd> for actions</div>
            </section>
            <GitBranchInspector branch={shownBranch} currentBranch={currentBranch} busy={!!busyAction} remoteBranches={remoteNames} tools={branchTools} {...branchActions} />
          </div>
        )}
        <footer className="git-branches-footer">
          <button type="button" className="git-control" disabled={notRepo || !!busyAction} onClick={() => void handleUpdateProject()}><ArrowDownLeft />Pull current</button>
          <button type="button" className="git-control" disabled={notRepo || !!busyAction} onClick={() => void handlePush()}><ArrowUpRight />Push current</button>
          {onOpenCommit && <button type="button" className="git-control" onClick={() => {
            onOpenCommit()
            onClose()
          }}><GitCommitHorizontal />Commit…</button>}
          <button type="button" className="git-control git-branches-maintenance" disabled={notRepo} onClick={() => {
            try { localStorage.setItem('omniterm:git-active-tab', 'maintenance') } catch { /* Storage can be unavailable. */ }
            window.dispatchEvent(new CustomEvent('omniterm:open-git'))
            window.dispatchEvent(new CustomEvent('omniterm:open-git-maintenance'))
            onClose()
          }}><Sparkles />Cleanup & prune</button>
        </footer>
        <GitResizeGrip label="Resize branch manager" corner="bottom-right" onResizeStart={startResize} onResizeKey={resizeWithKeyboard} onReset={resetSize} />
        {contextBranch && <GitBranchContextMenu title={contextBranch.branch.name} point={contextBranch.point} containerRef={popupRef} onClose={closeContext}>
          <fieldset disabled={!!busyAction}><GitBranchSubmenu branch={contextBranch.branch} currentBranch={currentBranch} inline compact {...branchActions} onClose={closeContext} /></fieldset>
        </GitBranchContextMenu>}
        {pendingDelete && <GitBranchDeleteDialog pending={pendingDelete} busy={!!busyAction} onConfirm={confirmDelete} onClose={cancelDelete} />}
      </div>
      {comparingBranch && <GitBranchDiffModal
        cwd={cwd}
        currentBranch={currentBranch ?? 'HEAD'}
        targetBranch={comparingBranch}
        onClose={() => setComparingBranch(null)}
        onOpenFileDiff={(path, branch) => {
          setComparingBranch(null)
          onClose()
          // Inside the Git view the host shows it directly; elsewhere (the footer) the view has to open first.
          if (onOpenFileDiff) onOpenFileDiff(path, branch)
          else requestFileDiff({ path, targetBranch: branch })
        }}
      />}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}

function nodesFor(branches: GitBranchInfo[], mode: 'tree' | 'flat'): GitBranchTreeNode[] {
  return mode === 'tree' ? buildBranchTree(branches) : branches.map((branch) => ({
    type: 'branch', name: branch.name, displayName: branch.name, branch,
  }))
}
