import { create } from 'zustand'

import { call, commands } from '../ide/platform/ipc'

import { normalizeDir } from './footerGitModel'

export interface ExternalRepo {
  root: string
  head: string | null
  headCommit: string | null
  ahead: number
  behind: number
}

/** A folder's repository outside the project (`null`: it holds none); absent until looked up. */
export const useExternalRepos = create<{ byDir: Record<string, ExternalRepo | null> }>(() => ({ byDir: {} }))

const pending = new Set<string>()

/**
 * Looks up the repository holding `dir`, for a terminal or agent working outside the project's own
 * repositories. The result is cached per folder; `refresh` re-reads the branch of a known one.
 */
export async function lookupExternalRepo(dir: string, refresh = false): Promise<void> {
  const key = normalizeDir(dir)
  const known = key in useExternalRepos.getState().byDir
  if ((known && !refresh) || pending.has(key)) return
  pending.add(key)
  let found: ExternalRepo | null = null
  try {
    const root = await call(commands.vcsOpenExternalLog(key))
    const info = await call(commands.vcsBranchInfo(root))
    found = { root: normalizeDir(root), head: info.head, headCommit: info.headCommit, ahead: info.ahead, behind: info.behind }
  } catch {
    found = null
  } finally {
    pending.delete(key)
  }
  useExternalRepos.setState((state) => ({ byDir: { ...state.byDir, [key]: found } }))
}
