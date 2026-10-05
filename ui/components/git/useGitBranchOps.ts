import { useCallback, useEffect, useMemo, useState } from 'react'
import { createGitAPI } from '../../gitAPI'
import type { GitBranchInfo } from './gitTypes'

/** A delete waiting on the user: its worktree would go too, or git refused it and force remains. */
export interface PendingBranchDelete {
  branch: string
  /** The linked worktree that has `branch` checked out and is removed with it. */
  worktreePath?: string
  error?: string
}

interface UseGitBranchOpsOptions {
  cwd: string
  currentBranch?: string
  onClose: () => void
  onBranchSwitched?: () => void
  onBranchDeleted?: (branch: string) => void
}

export function useGitBranchOps({
  cwd,
  currentBranch,
  onClose,
  onBranchSwitched,
  onBranchDeleted,
}: UseGitBranchOpsOptions) {
  const api = useMemo(() => createGitAPI(), [])
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ text: string; isError?: boolean } | null>(null)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [startPoint, setStartPoint] = useState<string | undefined>(undefined)
  const [notRepo, setNotRepo] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingBranchDelete | null>(null)

  const notify = useCallback((text: string, isError = false) => {
    setActionNotice({ text, isError })
    setTimeout(() => setActionNotice(null), 4000)
  }, [])

  const loadBranches = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.getBranches(cwd)
      setBranches(list)
      setNotRepo(false)
    } catch {
      setNotRepo(true)
    } finally {
      setLoading(false)
    }
  }, [api, cwd])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches])

  const handleUpdateProject = async () => {
    setBusyAction('Updating project (pull)...')
    try {
      const res = await api.pull(cwd, false)
      notify(res || 'Update complete')
      void loadBranches()
      onBranchSwitched?.()
    } catch (err) {
      notify(`Update failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handleFetch = async () => {
    setBusyAction('Fetching remotes...')
    try {
      const res = await api.fetch(cwd, true)
      notify(res || 'Fetch complete')
      void loadBranches()
    } catch (err) {
      notify(`Fetch failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handlePush = async () => {
    setBusyAction('Pushing commits...')
    try {
      const res = await api.push(cwd, true)
      notify(res || 'Push complete')
      void loadBranches()
    } catch (err) {
      notify(`Push failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handleCheckout = async (branchName: string) => {
    setBusyAction(`Checking out ${branchName}...`)
    try {
      await api.checkout(cwd, branchName)
      notify(`Switched to branch '${branchName}'`)
      void loadBranches()
      onBranchSwitched?.()
      onClose()
    } catch (err) {
      notify(`Checkout failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handleMerge = async (branchName: string) => {
    setBusyAction(`Merging ${branchName}...`)
    try {
      const res = await api.merge(cwd, branchName)
      notify(res || `Merged '${branchName}'`)
      void loadBranches()
      onBranchSwitched?.()
    } catch (err) {
      notify(`Merge failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handleRebase = async (branchName: string) => {
    setBusyAction(`Rebasing onto ${branchName}...`)
    try {
      const res = await api.rebase(cwd, branchName)
      notify(res || `Rebased onto '${branchName}'`)
      void loadBranches()
      onBranchSwitched?.()
    } catch (err) {
      notify(`Rebase failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBranchName.trim()) return
    setBusyAction(`Creating branch ${newBranchName}...`)
    try {
      await api.createBranch(cwd, newBranchName.trim(), startPoint, true)
      notify(`Created and checked out '${newBranchName}'`)
      setNewBranchName('')
      setCreatingBranch(false)
      void loadBranches()
      onBranchSwitched?.()
      onClose()
    } catch (err) {
      notify(`Create branch failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  /**
   * Branch maintenance that leaves the checkout alone. Resolves to the error text (null on success)
   * so the dialog or form that asked can keep itself open and show why.
   */
  const runBranchTool = async (label: string, action: () => Promise<string>): Promise<string | null> => {
    setBusyAction(label)
    try {
      notify(await action())
      void loadBranches()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
      return null
    } catch (err) {
      return String(err)
    } finally {
      setBusyAction(null)
    }
  }

  /**
   * The checked-out branch pulls from its upstream; any other branch is fast-forwarded in place,
   * without checking it out. Bringing another branch into this one is what merge is for.
   */
  const handlePullBranch = async (branchName: string) => {
    const isCurrent = branchName === currentBranch
      || (!currentBranch && branches.some((branch) => branch.name === branchName && branch.is_current))
    if (isCurrent) {
      await handleUpdateProject()
      return
    }
    const failure = await runBranchTool(`Pulling ${branchName}...`, () => api.updateBranch(cwd, branchName))
    if (failure) notify(`Pull failed: ${failure}`, true)
  }

  const deleteBranch = async (request: PendingBranchDelete, force: boolean) => {
    setBusyAction(`Deleting ${request.branch}...`)
    try {
      const result = await api.deleteBranches(cwd, [request.branch], force, Boolean(request.worktreePath))
      const failure = result.failed[0]
      if (failure) {
        setPendingDelete({ ...request, error: failure.reason })
        return
      }
      setPendingDelete(null)
      onBranchDeleted?.(request.branch)
      notify(result.removed_worktrees?.length
        ? `Deleted '${request.branch}' and its worktree`
        : `Deleted '${request.branch}'`)
      void loadBranches()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setPendingDelete({ ...request, error: String(err) })
    } finally {
      setBusyAction(null)
    }
  }

  /**
   * Deletes a local branch right away when git can do it safely. A branch checked out in another
   * linked worktree (an agent's, under `.claude/worktrees/`) asks first, since its folder goes too.
   */
  const handleDeleteBranch = async (branchName: string) => {
    const worktrees = await api.listWorktrees(cwd).catch(() => [])
    const holder = (Array.isArray(worktrees) ? worktrees : [])
      .find((worktree) => worktree.branch === branchName && !worktree.is_main && !worktree.is_current)
    if (holder && !holder.is_prunable) setPendingDelete({ branch: branchName, worktreePath: holder.path })
    else await deleteBranch({ branch: branchName }, false)
  }

  const confirmDelete = (force: boolean) => {
    if (pendingDelete) void deleteBranch(pendingDelete, force)
  }

  const handleRenameBranch = (branchName: string, newName: string) =>
    runBranchTool(`Renaming ${branchName}...`, () => api.renameBranch(cwd, branchName, newName.trim()))

  const handleSetUpstream = (branchName: string, upstream: string | null) =>
    runBranchTool(`Updating upstream of ${branchName}...`, () => api.setUpstream(cwd, branchName, upstream))

  /** Creates the worktree, then opens a terminal in it — the point of a worktree is working there. */
  const handleAddWorktree = (branchName: string) =>
    runBranchTool(`Creating worktree for ${branchName}...`, async () => {
      const path = await api.addWorktree(cwd, branchName)
      window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd: path } }))
      return `Worktree ready at ${path}`
    })

  const handleInitRepo = async () => {
    setBusyAction('Initializing Git repository...')
    try {
      await api.init(cwd)
      notify('Initialized empty Git repository')
      setNotRepo(false)
      void loadBranches()
      onBranchSwitched?.()
    } catch (err) {
      notify(`Init failed: ${String(err)}`, true)
    } finally {
      setBusyAction(null)
    }
  }

  return {
    branches,
    loading,
    busyAction,
    actionNotice,
    creatingBranch,
    setCreatingBranch,
    newBranchName,
    setNewBranchName,
    startPoint,
    setStartPoint,
    notRepo,
    loadBranches,
    handleUpdateProject,
    handleFetch,
    handlePush,
    handleCheckout,
    handleMerge,
    handleRebase,
    handleCreateBranch,
    handleInitRepo,
    handlePullBranch,
    handleDeleteBranch,
    pendingDelete,
    confirmDelete,
    cancelDelete: () => setPendingDelete(null),
    handleRenameBranch,
    handleSetUpstream,
    handleAddWorktree,
  }
}
