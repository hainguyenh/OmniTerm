import type { GitWorktreeInfo } from './gitTypes'
import { normalizePath } from './useGitProjects'

export function getWorktreeName(worktree: GitWorktreeInfo): string {
  return worktree.is_main ? 'Main checkout' : normalizePath(worktree.path).split('/').pop() || worktree.path
}

export function getWorktreeHead(worktree: GitWorktreeInfo): string {
  if (worktree.branch) return worktree.branch
  if (worktree.is_bare) return 'Bare repository'
  return worktree.head ? `Detached HEAD · ${worktree.head.slice(0, 7)}` : 'Detached HEAD'
}

export function getActiveWorktree(worktrees: GitWorktreeInfo[], activePath: string | null): GitWorktreeInfo | undefined {
  const activeKey = activePath ? normalizePath(activePath).toLowerCase() : ''
  return worktrees.find((worktree) => normalizePath(worktree.path).toLowerCase() === activeKey)
    ?? worktrees.find((worktree) => worktree.is_current)
    ?? worktrees[0]
}
