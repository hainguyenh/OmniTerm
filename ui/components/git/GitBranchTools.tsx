import { Link, Pencil, SquareStack } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import type { GitBranchInfo } from './gitTypes'

/** Each tool resolves to the error text, or null once git accepted the change. */
export interface GitBranchToolActions {
  onRename: (branchName: string, newName: string) => Promise<string | null>
  onSetUpstream: (branchName: string, upstream: string | null) => Promise<string | null>
  onAddWorktree: (branchName: string) => Promise<string | null>
}

interface GitBranchToolsProps extends GitBranchToolActions {
  branch: GitBranchInfo
  isCurrent: boolean
  /** Remote branch names offered as upstream suggestions. */
  remoteBranches: string[]
  busy: boolean
}

type OpenTool = 'rename' | 'upstream' | null

/** The inspector's "More branch tools": rename, change the upstream, check out into a worktree. */
export function GitBranchTools({
  branch, isCurrent, remoteBranches, busy, onRename, onSetUpstream, onAddWorktree,
}: GitBranchToolsProps) {
  const [open, setOpen] = useState<OpenTool>(null)
  const [newName, setNewName] = useState(branch.name)
  const [upstream, setUpstream] = useState(branch.upstream ?? '')
  const [error, setError] = useState<string | null>(null)
  const remotesListId = useId()

  const run = async (action: () => Promise<string | null>) => {
    setError(null)
    const failure = await action()
    if (failure) setError(failure)
    else setOpen(null)
  }
  const toggle = (tool: Exclude<OpenTool, null>) => {
    setError(null)
    setOpen((current) => (current === tool ? null : tool))
  }
  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (name && name !== branch.name) void run(() => onRename(branch.name, name))
  }
  const submitUpstream = (event: FormEvent) => {
    event.preventDefault()
    if (upstream.trim()) void run(() => onSetUpstream(branch.name, upstream.trim()))
  }

  return (
    <details className="git-branch-more-tools">
      <summary>More branch tools</summary>
      {!branch.is_remote && <>
        <button type="button" aria-expanded={open === 'rename'} disabled={busy} onClick={() => toggle('rename')}><Pencil />Rename branch</button>
        {open === 'rename' && <form className="git-branch-tool-form" onSubmit={submitRename}>
          <input autoFocus aria-label="New branch name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          <button type="submit" className="git-control git-primary" disabled={busy || !newName.trim() || newName.trim() === branch.name}>Rename</button>
        </form>}
        <button type="button" aria-expanded={open === 'upstream'} disabled={busy} onClick={() => toggle('upstream')}><Link />Set upstream</button>
        {open === 'upstream' && <form className="git-branch-tool-form" onSubmit={submitUpstream}>
          <input autoFocus aria-label="Upstream branch" list={remotesListId} placeholder="origin/main" value={upstream} onChange={(event) => setUpstream(event.target.value)} />
          <datalist id={remotesListId}>{remoteBranches.map((name) => <option key={name} value={name} />)}</datalist>
          <button type="submit" className="git-control git-primary" disabled={busy || !upstream.trim()}>Track</button>
          {branch.upstream && <button type="button" className="git-control" disabled={busy} onClick={() => void run(() => onSetUpstream(branch.name, null))}>Stop tracking</button>}
        </form>}
      </>}
      <button
        type="button"
        disabled={busy || isCurrent}
        title={isCurrent ? 'The checked-out branch cannot be opened in a second worktree' : 'Check out into a new folder and open a terminal there'}
        onClick={() => void run(() => onAddWorktree(branch.name))}
      ><SquareStack />Open in worktree</button>
      {error && <p className="git-branch-tool-error" role="alert">{error}</p>}
    </details>
  )
}
