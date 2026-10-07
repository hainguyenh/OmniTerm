import { invoke } from '@tauri-apps/api/core'
import type {
  GitBlameLine,
  GitBranchComparison,
  GitBranchInfo,
  GitCommitDetails,
  GitCommitSummary,
  GitDeleteBranchesResult,
  GitFileContext,
  GitFileDiff,
  GitFileHistoryEntry,
  GitLineRange,
  GitRepoStatus,
  GitStashEntry,
  GitWorktreeInfo,
} from './components/git/gitTypes'

/** Thin renderer adapter for Git IPC commands. */
export function createGitAPI() {
  return {
    getStatus: (cwd: string) => invoke<GitRepoStatus>('git_status', { cwd }),
    getDiff: (cwd: string, filePath: string, staged: boolean) =>
      invoke<GitFileDiff>('git_diff', { cwd, filePath, staged }),
    getDiffBranch: (cwd: string, filePath: string, branch: string) =>
      invoke<GitFileDiff>('git_diff_branch', { cwd, filePath, branch }),
    /** Where a workspace file sits in its repository; rejects when it is not in a work tree. */
    getFileContext: (workspaceId: string, path: string) =>
      invoke<GitFileContext>('git_file_context', { workspaceId, path }),
    /** Commits touching `filePath`, or only `range` of it, newest first. */
    getFileHistory: (cwd: string, filePath: string, range?: GitLineRange, limit?: number) =>
      invoke<GitFileHistoryEntry[]>('git_file_history', {
        cwd,
        filePath,
        startLine: range?.start ?? null,
        endLine: range?.end ?? null,
        limit: limit ?? null,
      }),
    getBlame: (cwd: string, filePath: string) =>
      invoke<GitBlameLine[]>('git_blame', { cwd, filePath }),
    deleteFile: (cwd: string, filePath: string) =>
      invoke<void>('git_delete_file', { cwd, filePath }),
    stage: (cwd: string, paths: string[]) =>
      invoke<void>('git_stage', { cwd, paths }),
    unstage: (cwd: string, paths: string[]) =>
      invoke<void>('git_unstage', { cwd, paths }),
    revert: (cwd: string, paths: string[]) =>
      invoke<void>('git_revert', { cwd, paths }),
    commit: (cwd: string, message: string, amend: boolean) =>
      invoke<string>('git_commit', { cwd, message, amend }),
    getLog: (cwd: string, limit?: number, branch?: string | null) =>
      invoke<GitCommitSummary[]>('git_log', { cwd, limit: limit ?? null, branch: branch ?? null }),
    getCommitDetails: (cwd: string, commitId: string) =>
      invoke<GitCommitDetails>('git_commit_details', { cwd, commitId }),
    getCommitFileDiff: (cwd: string, commitId: string, filePath: string, oldPath?: string | null) =>
      invoke<GitFileDiff>('git_commit_file_diff', { cwd, commitId, filePath, oldPath: oldPath ?? null }),
    getBranches: (cwd: string) =>
      invoke<GitBranchInfo[]>('git_branches', { cwd }),
    checkout: (cwd: string, branch: string) =>
      invoke<string>('git_checkout', { cwd, branch }),
    createBranch: (cwd: string, name: string, startPoint?: string, checkout = true) =>
      invoke<string>('git_create_branch', { cwd, name, startPoint: startPoint ?? null, checkout }),
    /** With `removeWorktrees`, a branch checked out in a linked worktree takes the worktree with it. */
    deleteBranches: (cwd: string, branches: string[], force = false, removeWorktrees = false) =>
      invoke<GitDeleteBranchesResult>('git_delete_branches', { cwd, branches, force, removeWorktrees }),
    fetch: (cwd: string, prune = true) =>
      invoke<string>('git_fetch', { cwd, prune }),
    pull: (cwd: string, rebase = false) =>
      invoke<string>('git_pull', { cwd, rebase }),
    push: (cwd: string, setUpstream = false) =>
      invoke<string>('git_push', { cwd, setUpstream }),
    merge: (cwd: string, branch: string) =>
      invoke<string>('git_merge', { cwd, branch }),
    rebase: (cwd: string, branch: string) =>
      invoke<string>('git_rebase', { cwd, branch }),
    init: (cwd: string) =>
      invoke<string>('git_init', { cwd }),
    readFile: (cwd: string, filePath: string) =>
      invoke<string>('git_read_file', { cwd, filePath }),
    readFileRevision: (cwd: string, filePath: string, revision: string) =>
      invoke<string>('git_read_file_revision', { cwd, filePath, revision }),
    writeFile: (cwd: string, filePath: string, content: string) =>
      invoke<void>('git_write_file', { cwd, filePath, content }),
    compareBranches: (cwd: string, baseBranch: string, targetBranch: string) =>
      invoke<GitBranchComparison>('git_compare_branches', {
        cwd,
        baseBranch,
        targetBranch,
      }),
    getStashes: (cwd: string) =>
      invoke<GitStashEntry[]>('git_stash_list', { cwd }),
    saveStash: (cwd: string, message?: string, keepIndex = false) =>
      invoke<string>('git_stash_save', {
        cwd,
        message: message ?? null,
        keepIndex,
      }),
    popStash: (cwd: string, index?: number) =>
      invoke<string>('git_stash_pop', { cwd, index: index ?? null }),
    applyStash: (cwd: string, index?: number) =>
      invoke<string>('git_stash_apply', { cwd, index: index ?? null }),
    dropStash: (cwd: string, index: number) =>
      invoke<string>('git_stash_drop', { cwd, index }),
    cherryPick: (cwd: string, commitId: string) =>
      invoke<string>('git_cherry_pick', { cwd, commitId }),
    /** Fast-forward a branch that is not checked out to its upstream; refuses a diverged branch. */
    updateBranch: (cwd: string, branch: string) =>
      invoke<string>('git_update_branch', { cwd, branch }),
    renameBranch: (cwd: string, branch: string, newName: string) =>
      invoke<string>('git_rename_branch', { cwd, branch, newName }),
    /** `upstream` null removes the branch's upstream. */
    setUpstream: (cwd: string, branch: string, upstream: string | null) =>
      invoke<string>('git_set_upstream', { cwd, branch, upstream }),
    /** Check `branch` out into a new worktree; resolves to the worktree path. */
    addWorktree: (cwd: string, branch: string, path?: string) =>
      invoke<string>('git_add_worktree', { cwd, branch, path: path ?? null }),
    /** Every worktree of the repository containing `cwd`, the main worktree first. */
    listWorktrees: (cwd: string) =>
      invoke<GitWorktreeInfo[]>('git_worktrees', { cwd }),
  }
}
