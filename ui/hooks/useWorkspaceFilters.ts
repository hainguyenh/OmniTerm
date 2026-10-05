import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Workspace } from '@omniterm/contract'
import {
  DEFAULT_FOLDER_FILTER,
  DEFAULT_TREE_FILTER,
  type TreeFilter,
} from '../utils/workspaceFilter'

export interface FilterMenuState {
  workspaceId: string
  folderId?: string
  folderName?: string
  folderPath?: string
  appearanceOnly?: boolean
  anchor: DOMRect
}

export function areFiltersEqual(a: TreeFilter, b: TreeFilter): boolean {
  if (a.mode !== b.mode || a.showEmptyDirs !== b.showEmptyDirs) return false
  if (a.kinds.length !== b.kinds.length || !a.kinds.every((k, i) => k === b.kinds[i])) return false
  if (a.paths.length !== b.paths.length || !a.paths.every((p, i) => p === b.paths[i])) return false
  return true
}

export function useWorkspaceFilters(workspaces: Workspace[]) {
  const [filters, setFilters] = useState<Record<string, TreeFilter>>(() => {
    try {
      const saved = localStorage.getItem('cc.workspaceFilters')
      return saved ? JSON.parse(saved) as Record<string, TreeFilter> : {}
    } catch {
      return {}
    }
  })

  const [folderFilters, setFolderFilters] = useState<Record<string, Record<string, TreeFilter>>>(() => {
    try {
      const saved = localStorage.getItem('cc.workspaceFolderFilters')
      return saved ? JSON.parse(saved) as Record<string, Record<string, TreeFilter>> : {}
    } catch {
      return {}
    }
  })

  const [projectDefaultFilters, setProjectDefaultFilters] = useState<Record<string, TreeFilter>>(() => {
    try {
      const saved = localStorage.getItem('cc.projectDefaultFilters')
      return saved ? JSON.parse(saved) as Record<string, TreeFilter> : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify(filters))
  }, [filters])

  useEffect(() => {
    localStorage.setItem('cc.workspaceFolderFilters', JSON.stringify(folderFilters))
  }, [folderFilters])

  useEffect(() => {
    localStorage.setItem('cc.projectDefaultFilters', JSON.stringify(projectDefaultFilters))
  }, [projectDefaultFilters])

  const [filterMenu, setFilterMenu] = useState<FilterMenuState | null>(null)

  const filterOf = useCallback(
    (wsId: string): TreeFilter => filters[wsId] ?? DEFAULT_TREE_FILTER,
    [filters],
  )

  const getFolderFilter = useCallback(
    (workspaceId: string, folderId: string, folderPath?: string): TreeFilter => {
      const override = folderFilters[workspaceId]?.[folderId]
      if (override) return override
      if (folderPath && projectDefaultFilters[folderPath]) return projectDefaultFilters[folderPath]
      if (projectDefaultFilters[folderId]) return projectDefaultFilters[folderId]
      return DEFAULT_FOLDER_FILTER
    },
    [folderFilters, projectDefaultFilters],
  )

  const resolvedFolderFilters = useMemo(() => {
    const res: Record<string, Record<string, TreeFilter>> = {}
    for (const ws of workspaces) {
      const wsFilters = folderFilters[ws.id] ?? {}
      const merged: Record<string, TreeFilter> = {}
      for (const folder of ws.folders) {
        const custom = wsFilters[folder.id]
        if (custom) {
          merged[folder.id] = custom
        } else {
          const projectDefault = (folder.path ? projectDefaultFilters[folder.path] : undefined)
            ?? projectDefaultFilters[folder.id]
          if (projectDefault) {
            merged[folder.id] = projectDefault
          }
        }
      }
      res[ws.id] = merged
    }
    return res
  }, [workspaces, folderFilters, projectDefaultFilters])

  const setWorkspaceFilter = useCallback((workspaceId: string, filter: TreeFilter) => {
    setFilters(prev => ({ ...prev, [workspaceId]: filter }))
  }, [])

  const setFolderFilter = useCallback((workspaceId: string, folderId: string, filter: TreeFilter) => {
    setFolderFilters(prev => ({
      ...prev,
      [workspaceId]: {
        ...(prev[workspaceId] ?? {}),
        [folderId]: filter,
      },
    }))
  }, [])

  const clearFolderFilterOverride = useCallback((workspaceId: string, folderId: string) => {
    setFolderFilters(prev => {
      const current = prev[workspaceId]
      if (!current?.[folderId]) return prev
      const nextWs = { ...current }
      delete nextWs[folderId]
      const next = { ...prev }
      if (Object.keys(nextWs).length === 0) delete next[workspaceId]
      else next[workspaceId] = nextWs
      return next
    })
  }, [])

  const setProjectDefaultFilter = useCallback((folderKey: string, filter: TreeFilter) => {
    setProjectDefaultFilters(prev => ({ ...prev, [folderKey]: filter }))
  }, [])

  const clearProjectDefaultFilter = useCallback((folderKey: string) => {
    setProjectDefaultFilters(prev => {
      if (!prev[folderKey]) return prev
      const next = { ...prev }
      delete next[folderKey]
      return next
    })
  }, [])

  const openFilterMenu = useCallback((workspaceId: string, anchor: DOMRect) => {
    setFilterMenu(prev => (
      prev?.workspaceId === workspaceId && !prev.folderId
        ? null
        : { workspaceId, anchor }
    ))
  }, [])

  const openFolderFilterMenu = useCallback((
    workspaceId: string,
    folderId: string,
    folderName: string,
    anchor: DOMRect,
    folderPath?: string,
  ) => {
    setFilterMenu(prev => (
      prev?.workspaceId === workspaceId && prev.folderId === folderId
        ? null
        : { workspaceId, folderId, folderName, folderPath, anchor }
    ))
  }, [])

  const openWorkspaceAppearanceMenu = useCallback((workspaceId: string, anchor: DOMRect) => {
    setFilterMenu(prev => (
      prev?.workspaceId === workspaceId && prev.appearanceOnly
        ? null
        : { workspaceId, appearanceOnly: true, anchor }
    ))
  }, [])

  const closeFilterMenu = useCallback(() => {
    setFilterMenu(null)
  }, [])

  return {
    filters,
    setFilters,
    folderFilters,
    setFolderFilters,
    projectDefaultFilters,
    setProjectDefaultFilters,
    filterMenu,
    setFilterMenu,
    filterOf,
    getFolderFilter,
    resolvedFolderFilters,
    setWorkspaceFilter,
    setFolderFilter,
    clearFolderFilterOverride,
    setProjectDefaultFilter,
    clearProjectDefaultFilter,
    openFilterMenu,
    openFolderFilterMenu,
    openWorkspaceAppearanceMenu,
    closeFilterMenu,
  }
}
