import { useMemo, useState } from 'react'

import type { Workspace } from '../../domain'
import { workspaceQuickStartProjects, type QuickStartProject } from '../../utils/sessionQuickStart'
import { comparablePath, useProjectFilterStore } from '../projectFilterStore'

interface QuickStartProjectChoice {
  projects: QuickStartProject[]
  /** The chosen project; until one is chosen, the workspace's default project, else the first. */
  project: QuickStartProject | null
  choose: (key: string) => void
}

/** The projects a session can start in, and the one chosen among them (see SessionsQuickStart). */
export function useQuickStartProject(
  workspaces: readonly Workspace[],
  workspaceId: string | null | undefined,
): QuickStartProjectChoice {
  const projects = useMemo(() => workspaceQuickStartProjects(workspaces, workspaceId), [workspaces, workspaceId])
  const preferred = useProjectFilterStore((state) => (workspaceId ? state.defaults[workspaceId] : undefined))
  const [chosen, choose] = useState<string | null>(null)
  const project = projects.find((item) => item.key === chosen)
    ?? (preferred ? projects.find((item) => comparablePath(item.cwd) === comparablePath(preferred)) : undefined)
    ?? projects[0]
    ?? null
  return { projects, project, choose }
}
