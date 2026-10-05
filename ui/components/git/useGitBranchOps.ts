import { useCallback, useEffect, useMemo, useState } from 'react'
import { createGitAPI } from '../../gitAPI'
import type { GitBranchInfo } from './gitTypes'

interface UseGitBranchOpsOptions {
  cwd: string
  currentBranch?: string
  onClose: () => void
  onBranchSwitched?: () => void
}

export function useGitBranchOps({
  cwd,
  currentBranch: _currentBranch,
  onClose,
  onBranchSwitched,
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

  const handleUpdateBranch = (branchName: string) =>
    runBranchTool(`Updating ${branchName}...`, () => api.updateBranch(cwd, branchName))

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
    handleUpdateBranch,
    handleRenameBranch,
    handleSetUpstream,
    handleAddWorktree,
  }
}
