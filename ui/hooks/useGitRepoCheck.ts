import { useEffect, useState } from 'react'
import { createGitAPI } from '../gitAPI'

const repoCache = new Map<string, boolean>()

export function checkIsGitRepo(cwd: string): Promise<boolean> {
  const norm = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!norm) return Promise.resolve(false)
  if (repoCache.has(norm)) return Promise.resolve(repoCache.get(norm)!)

  const api = createGitAPI()
  return api
    .getStatus(norm)
    .then(() => {
      repoCache.set(norm, true)
      return true
    })
    .catch(() => {
      repoCache.set(norm, false)
      return false
    })
}

export function clearGitRepoCache(): void {
  repoCache.clear()
}

/**
 * Checks whether the specified working directory is inside a valid Git repository
 * (contains a `.git` directory / root resolved by git).
 */
export function useGitRepoCheck(cwd?: string, enabled = true): boolean {
  const [isRepo, setIsRepo] = useState<boolean>(() => {
    if (!cwd || !enabled) return false
    const norm = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return repoCache.get(norm) ?? false
  })

  useEffect(() => {
    if (!cwd || !enabled) {
      setIsRepo(false)
      return
    }

    let active = true
    const norm = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '')

    const verify = () => {
      checkIsGitRepo(norm)
        .then((valid) => {
          if (active) setIsRepo(valid)
        })
        .catch(() => {
          if (active) setIsRepo(false)
        })
    }

    verify()

    const onRefresh = () => {
      repoCache.delete(norm)
      verify()
    }

    window.addEventListener('omniterm:git-refresh', onRefresh)
    return () => {
      active = false
      window.removeEventListener('omniterm:git-refresh', onRefresh)
    }
  }, [cwd, enabled])

  return isRepo
}
