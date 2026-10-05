import { useCallback, useEffect, useState } from 'react'

import { createGitAPI } from '../../gitAPI'
import type { GitWorktreeInfo } from './gitTypes'
import { normalizePath } from './useGitProjects'

const SELECTION_KEY = 'omniterm:git-worktree-selection'

type WorktreeSelection = Record<string, string>

const NO_WORKTREES: GitWorktreeInfo[] = []

const keyOf = (path: string) => normalizePath(path).toLowerCase()

function readSelection(): WorktreeSelection {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function writeSelection(selection: WorktreeSelection) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}

/**
 * The worktrees of `projectPath`'s repository and which one the Git view works on. The choice is
 * remembered per project, so reviewing an agent's worktree survives switching projects. Until the
 * listing arrives a remembered worktree is trusted; afterwards it must still exist.
 */
export function useGitWorktrees(projectPath: string | null | undefined) {
  const [listing, setListing] = useState<{ project: string; worktrees: GitWorktreeInfo[] } | null>(null)
  const [selection, setSelection] = useState<WorktreeSelection>(readSelection)

  useEffect(() => {
    if (!projectPath) return
    let active = true
    const api = createGitAPI()
    const load = () => {
      void api
        .listWorktrees(projectPath)
        .then((worktrees) => {
          // An adapter without worktree support answers with nothing; treat that as no worktrees.
          if (active) setListing({ project: projectPath, worktrees: Array.isArray(worktrees) ? worktrees : [] })
        })
        .catch(() => {
          if (active) setListing({ project: projectPath, worktrees: [] })
        })
    }
    load()
    window.addEventListener('omniterm:git-refresh', load)
    return () => {
      active = false
      window.removeEventListener('omniterm:git-refresh', load)
    }
  }, [projectPath])

  const loaded = Boolean(projectPath && listing?.project === projectPath)
  const worktrees = loaded && listing ? listing.worktrees : NO_WORKTREES
  const remembered = projectPath ? selection[keyOf(projectPath)] : undefined
  const chosen = remembered
    ? worktrees.find((worktree) => !worktree.is_prunable && keyOf(worktree.path) === keyOf(remembered))
    : undefined
  const activeRaw = chosen?.path ?? (loaded ? undefined : remembered) ?? projectPath
  const activePath = activeRaw ? normalizePath(activeRaw) : null

  const selectWorktree = useCallback((path: string) => {
    if (!projectPath) return
    const own = worktrees.find((worktree) => worktree.is_current)
    const isOwn = keyOf(path) === keyOf(projectPath) || (own !== undefined && keyOf(path) === keyOf(own.path))
    setSelection((previous) => {
      const next = { ...previous }
      // The project's own checkout is the default, so going back to it forgets the choice.
      if (isOwn) delete next[keyOf(projectPath)]
      else next[keyOf(projectPath)] = normalizePath(path)
      writeSelection(next)
      return next
    })
  }, [projectPath, worktrees])

  return { worktrees, activePath, selectWorktree }
}
