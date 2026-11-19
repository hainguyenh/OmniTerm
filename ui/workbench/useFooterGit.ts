import { useEffect, useMemo } from 'react'

import { useEditorRegistry } from '../ide/editor/api'
import { useTabs } from '../ide/editor/core/controller'
import { repoName, useVcs } from '../ide/features/vcs/store'
import { decodeWorkspaceSelection } from '../utils/workspaceSelection'
import { usePanePresence } from '../utils/agentPresenceStore'
import { useWorkspaceStore } from '../platform/workspaceStore'

import { lookupExternalRepo, useExternalRepos } from './externalRepos'
import { footerContextPath, normalizeDir, rootContaining, type FooterContext } from './footerGitModel'
import { parseSessionInput } from './sessions/sessionInput'
import { useShellPanels } from './shellPanelsStore'

export interface FooterGit {
  root: string
  /** The repository's folder name, for the tooltip. */
  repo: string
  head: string | null
  headCommit: string | null
  ahead: number
  behind: number
  /** The repository belongs to the project, so the Branches popup can act on it. */
  inProject: boolean
}

const EXTERNAL_REFRESH_MS = 15_000

/** The active session tab's id, null while an editor tab is active. */
function useActiveSession(): string | null {
  return useTabs((state) => {
    const pane = state.panes[state.activePane]
    return parseSessionInput(pane?.tabs.find((tab) => tab.id === pane.active)?.input)
  })
}

/** The default (selected) project's folder path. */
function useDefaultFolder(): string | null {
  return useWorkspaceStore((state) => {
    const selection = decodeWorkspaceSelection(state.selection)
    const workspace = state.workspaces.find((item) => item.id === selection?.workspaceId)
    const folders = workspace?.folders?.filter((folder) => !folder.disabled) ?? []
    return (folders.find((folder) => folder.id === selection?.folderId) ?? folders[0])?.path ?? null
  })
}

/**
 * The repository the footer's Git widget shows. It follows what the user is looking at: the active
 * editor file, or the folder the active terminal or AI agent works in, which may lie outside the
 * project; otherwise the default project's repository.
 */
export function useFooterGit(): FooterGit | null {
  const sessionId = useActiveSession()
  const presence = usePanePresence(sessionId)
  const sessionCwd = useShellPanels((state) => (sessionId ? state.sessions?.sessionCwds[sessionId] : undefined))
  const editorPath = useEditorRegistry((state) => state.active?.ctx.path ?? null)
  const defaultFolder = useDefaultFolder()
  const roots = useVcs((state) => state.roots)
  const heads = useVcs((state) => state.heads)
  const selected = useVcs((state) => state.repo)
  const branch = useVcs((state) => state.branch)
  const available = useVcs((state) => state.available)
  const external = useExternalRepos((state) => state.byDir)

  const launchCwd = presence?.launchCwd
  const path = useMemo(() => {
    const context: FooterContext = {
      editorPath,
      session: sessionId ? { launchCwd, cwd: sessionCwd } : null,
      defaultFolder,
    }
    return footerContextPath(context)
  }, [editorPath, sessionId, launchCwd, sessionCwd, defaultFolder])
  const projectRoot = path && available ? rootContaining(path, roots) : null
  const needsLookup = path !== null && projectRoot === null
  const externalRepo = needsLookup && path ? (external[normalizeDir(path)] ?? null) : null

  useEffect(() => {
    if (!needsLookup || !path) return undefined
    void lookupExternalRepo(path)
    const timer = setInterval(() => void lookupExternalRepo(path, true), EXTERNAL_REFRESH_MS)
    return () => clearInterval(timer)
  }, [needsLookup, path])

  if (externalRepo) {
    return { ...externalRepo, repo: repoName(externalRepo.root), inProject: false }
  }
  // Nothing in front of the user maps to a repository of its own: the default project's one.
  const root = projectRoot ?? (selected && roots.includes(selected) ? selected : (roots[0] ?? null))
  if (!available || !root) return null
  const head = heads[root]
  const detail = root === selected ? branch : null
  if (!head && !detail) return null
  return {
    root,
    repo: repoName(root),
    head: head?.head ?? detail?.head ?? null,
    headCommit: head?.headCommit ?? detail?.headCommit ?? null,
    ahead: detail?.ahead ?? 0,
    behind: detail?.behind ?? 0,
    inProject: true,
  }
}
