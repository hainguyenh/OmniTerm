import { useEffect, useState } from 'react'

import { createGitAPI } from '../../gitAPI'
import type { GitFileContext } from '../git/gitTypes'

/**
 * Where a workspace file sits in its Git repository, or null when it is not in one (or not yet
 * known). Resolved the first time `enabled` is true and again after any `omniterm:git-refresh`, which
 * is how a checkout elsewhere in the app reaches the branch name shown here.
 */
export function useGitFileContext(workspaceId: string, path: string, enabled: boolean): GitFileContext | null {
  const [revision, setRevision] = useState(0)
  const [resolved, setResolved] = useState<{ key: string; context: GitFileContext | null } | null>(null)
  const key = `${workspaceId}\u0000${path}\u0000${revision}`

  useEffect(() => {
    const onRefresh = () => setRevision((value) => value + 1)
    window.addEventListener('omniterm:git-refresh', onRefresh)
    return () => window.removeEventListener('omniterm:git-refresh', onRefresh)
  }, [])

  useEffect(() => {
    if (!enabled || resolved?.key === key) return
    let active = true
    createGitAPI().getFileContext(workspaceId, path).then(
      (context) => { if (active) setResolved({ key, context }) },
      () => { if (active) setResolved({ key, context: null }) },
    )
    return () => { active = false }
  }, [enabled, key, resolved?.key, workspaceId, path])

  // A stale answer for another file is never shown; one for an older revision of this file is fine.
  return resolved && resolved.key.startsWith(`${workspaceId}\u0000${path}\u0000`) ? resolved.context : null
}
