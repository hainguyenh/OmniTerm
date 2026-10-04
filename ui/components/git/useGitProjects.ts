import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Connection, Workspace } from '@omniterm/contract'
import type { GitProject } from './gitTypes'

const STORAGE_KEY = 'omniterm:selected-git-project'

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export function useGitProjects(
  workspaces: Workspace[] = [],
  activeCwd?: string,
  savedConnections: Connection[] = [],
) {
  const [selectedPath, setSelectedPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  // Aggregate candidate project folders without running expensive disk I/O
  const projects = useMemo(() => {
    const list: GitProject[] = []
    const seen = new Set<string>()

    const addCandidate = (id: string, name: string, path: string, category: string) => {
      if (!path) return
      const normalized = normalizePath(path)
      if (!normalized || seen.has(normalized.toLowerCase())) return
      seen.add(normalized.toLowerCase())
      list.push({ id, name, path: normalized, category })
    }

    // 1. Workspace folders (highest priority - user curated)
    for (const ws of workspaces) {
      for (const folder of ws.folders ?? []) {
        addCandidate(`wf:${folder.id}`, folder.name || ws.name, folder.path, 'Workspace')
      }
    }

    // 2. Local connection profiles
    for (const conn of savedConnections) {
      if (conn.type === 'LOCAL' && conn.localCwd) {
        addCandidate(`conn:${conn.id}`, conn.name, conn.localCwd, 'Connection')
      }
    }

    // 3. Active terminal session CWD (if active)
    if (activeCwd) {
      addCandidate('active:cwd', 'Active Terminal', activeCwd, 'Terminal')
    }

    // 4. Stored custom project folder
    if (selectedPath) {
      const norm = normalizePath(selectedPath)
      if (norm && !seen.has(norm.toLowerCase())) {
        const folderName = norm.split('/').pop() || norm
        addCandidate(`custom:${norm}`, folderName, norm, 'Folder')
      }
    }

    return list
  }, [workspaces, activeCwd, savedConnections, selectedPath])

  // Resolve active path: selectedPath if still in candidate list, else fallback to activeCwd or first project
  const resolvedPath = useMemo(() => {
    if (selectedPath) {
      const found = projects.find((p) => p.path.toLowerCase() === normalizePath(selectedPath).toLowerCase())
      if (found) return found.path
    }
    if (activeCwd) {
      const activeNormalized = normalizePath(activeCwd)
      const foundActive = projects.find((p) => p.path.toLowerCase() === activeNormalized.toLowerCase())
      if (foundActive) return foundActive.path
      return activeNormalized
    }
    return projects[0]?.path ?? null
  }, [selectedPath, projects, activeCwd])

  const selectProject = useCallback((path: string) => {
    const normalized = normalizePath(path)
    setSelectedPath(normalized)
    try {
      localStorage.setItem(STORAGE_KEY, normalized)
      window.dispatchEvent(new CustomEvent('omniterm:git-project-change', { detail: { path: normalized } }))
    } catch {
      // storage unavailable
    }
  }, [])

  // Sync when external change event occurs
  useEffect(() => {
    const handleProjectChange = (e: Event) => {
      const detailPath = (e as CustomEvent<{ path: string }>).detail?.path
      if (detailPath) setSelectedPath(normalizePath(detailPath))
    }
    window.addEventListener('omniterm:git-project-change', handleProjectChange)
    return () => window.removeEventListener('omniterm:git-project-change', handleProjectChange)
  }, [])

  return {
    projects,
    activePath: resolvedPath,
    selectProject,
  }
}
