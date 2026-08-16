import { useCallback, useEffect, useState } from 'react'
import type { LayoutMode } from '../themes'
import { createDefaultViewGroup, createViewGroup, DEFAULT_VIEW_GROUP_ID, type ViewGroup } from '../viewGroups'

interface UseViewGroupsInput {
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  panes: (string | null)[]
  setPanes: (panes: (string | null)[]) => void
  focusedPane: number
  setFocusedPane: (pane: number) => void
  activeTabs?: { id: string }[]
}

export function useViewGroups({ layoutMode, setLayoutMode, panes, setPanes, focusedPane, setFocusedPane, activeTabs = [] }: UseViewGroupsInput) {
  const [viewGroups, setViewGroups] = useState<ViewGroup[]>(() => [createDefaultViewGroup(layoutMode)])
  const [activeGroupId, setActiveGroupId] = useState(DEFAULT_VIEW_GROUP_ID)
  const [tabGroups, setTabGroups] = useState<Record<string, string>>({})

  useEffect(() => {
    setViewGroups(prev => {
      const current = prev.find(group => group.id === activeGroupId)
      if (!current) return prev
      const activeIds = new Set(panes.filter((id): id is string => id !== null))
      const next = prev
        .map(group => {
          if (group.id === activeGroupId) {
            const nextLayoutMode = group.id === DEFAULT_VIEW_GROUP_ID ? 1 : layoutMode
            if (group.layoutMode === nextLayoutMode && group.focusedPane === focusedPane
              && group.panes.length === panes.length && group.panes.every((id, index) => id === panes[index])) return group
            return { ...group, layoutMode: nextLayoutMode, panes: [...panes], focusedPane }
          }
          const nextPanes = activeGroupId === DEFAULT_VIEW_GROUP_ID
            ? group.panes
            : group.panes.map(id => id !== null && activeIds.has(id) ? null : id)
          return nextPanes.every((id, index) => id === group.panes[index]) ? group : { ...group, panes: nextPanes }
        })
        .filter(group => group.id === DEFAULT_VIEW_GROUP_ID || group.persistent === true || group.panes.some(id => id !== null))
      return next.length === prev.length && next.every((group, index) => group === prev[index]) ? prev : next
    })
  }, [activeGroupId, focusedPane, layoutMode, panes])

  useEffect(() => {
    if (activeGroupId !== DEFAULT_VIEW_GROUP_ID && !viewGroups.some(group => group.id === activeGroupId)) {
      setActiveGroupId(DEFAULT_VIEW_GROUP_ID)
      setLayoutMode(1)
    }
  }, [activeGroupId, setLayoutMode, viewGroups])

  useEffect(() => {
    if (layoutMode <= 1 || activeGroupId !== DEFAULT_VIEW_GROUP_ID || !panes.some(Boolean)) return
    const existingGroup = viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID && group.panes.some(pane => pane !== null && panes.includes(pane)))
    if (existingGroup) {
      setActiveGroupId(existingGroup.id)
      return
    }
    const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setViewGroups(prev => {
      const group = createViewGroup(id, prev.filter(group => group.id !== DEFAULT_VIEW_GROUP_ID).length + 1, layoutMode)
      group.panes = [...panes]
      group.focusedPane = focusedPane
      const defaultGroup = prev.find(item => item.id === DEFAULT_VIEW_GROUP_ID)
      return [...prev.filter(item => item.id !== DEFAULT_VIEW_GROUP_ID), group, ...(defaultGroup ? [defaultGroup] : [])]
    })
    setActiveGroupId(id)
  }, [activeGroupId, focusedPane, layoutMode, panes, viewGroups])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const group of viewGroups) {
      if (group.id === DEFAULT_VIEW_GROUP_ID) continue
      for (const id of group.panes) if (id !== null) next[id] = group.id
    }
    const keys = Object.keys(tabGroups)
    if (keys.length === Object.keys(next).length && keys.every(id => tabGroups[id] === next[id])) return
    setTabGroups(next)
  }, [setTabGroups, tabGroups, viewGroups])

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: unknown; patch?: unknown }>).detail
      if (typeof detail?.groupId !== 'string' || !detail.patch || typeof detail.patch !== 'object') return
      if (detail.groupId === DEFAULT_VIEW_GROUP_ID) return
      const patch = detail.patch as { label?: unknown; color?: unknown; persistent?: unknown }
      setViewGroups(prev => prev.map(group => group.id === detail.groupId
        ? {
          ...group,
          ...(typeof patch.label === 'string' ? { label: patch.label } : {}),
          ...(typeof patch.color === 'string' ? { color: patch.color } : {}),
          ...(typeof patch.persistent === 'boolean' ? { persistent: patch.persistent } : {}),
          ...((typeof patch.label === 'string' || typeof patch.color === 'string') ? { persistent: true } : {}),
        }
        : group))
    }
    window.addEventListener('omniterm:update-view-group', onUpdate)
    return () => window.removeEventListener('omniterm:update-view-group', onUpdate)
  }, [])

  useEffect(() => {
    const onReorder = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId?: unknown; targetId?: unknown; before?: unknown }>).detail
      if (typeof detail?.sourceId !== 'string' || typeof detail.targetId !== 'string' || detail.sourceId === detail.targetId) return
      if (detail.sourceId === DEFAULT_VIEW_GROUP_ID || detail.targetId === DEFAULT_VIEW_GROUP_ID) return
      setViewGroups(prev => {
        const sourceIndex = prev.findIndex(group => group.id === detail.sourceId)
        const targetIndex = prev.findIndex(group => group.id === detail.targetId)
        if (sourceIndex < 0 || targetIndex < 0) return prev
        const next = prev.filter(group => group.id !== detail.sourceId)
        const adjustedTarget = next.findIndex(group => group.id === detail.targetId)
        const insertAt = adjustedTarget + (detail.before === true ? 0 : 1)
        next.splice(insertAt, 0, prev[sourceIndex])
        return next
      })
    }
    window.addEventListener('omniterm:reorder-view-groups', onReorder)
    return () => window.removeEventListener('omniterm:reorder-view-groups', onReorder)
  }, [])

  useEffect(() => {
    const onUngroup = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: unknown }>).detail?.groupId
      if (typeof groupId !== 'string') return
      if (groupId === DEFAULT_VIEW_GROUP_ID) return
      const group = viewGroups.find(item => item.id === groupId)
      if (!group) return
      setViewGroups(prev => prev.filter(item => item.id !== groupId))
      if (activeGroupId === groupId) {
        setActiveGroupId(DEFAULT_VIEW_GROUP_ID)
        setLayoutMode(1)
        
        const nextPanes = [...group.panes]
        if (nextPanes[0] === null) {
          const ungroupedTabs = activeTabs.filter(t => !tabGroups[t.id])
          if (ungroupedTabs.length > 0) nextPanes[0] = ungroupedTabs[0].id
        }
        
        setPanes(nextPanes)
        setFocusedPane(0)
      }
    }
    window.addEventListener('omniterm:ungroup-view-group', onUngroup)
    return () => window.removeEventListener('omniterm:ungroup-view-group', onUngroup)
  }, [activeGroupId, setFocusedPane, setLayoutMode, setPanes, viewGroups])

  const switchViewGroup = useCallback((groupId: string) => {
    const group = viewGroups.find(item => item.id === groupId)
    if (!group || group.id === activeGroupId) return
    setActiveGroupId(group.id)
    setLayoutMode(group.id === DEFAULT_VIEW_GROUP_ID ? 1 : group.layoutMode)
    
    const nextPanes = [...group.panes]
    if (groupId === DEFAULT_VIEW_GROUP_ID && nextPanes[0] === null) {
      const ungroupedTabs = activeTabs.filter(t => !tabGroups[t.id])
      if (ungroupedTabs.length > 0) nextPanes[0] = ungroupedTabs[0].id
    }
    
    setPanes(nextPanes)
    setFocusedPane(Math.min(group.focusedPane, group.layoutMode - 1))
  }, [activeGroupId, setFocusedPane, setLayoutMode, setPanes, viewGroups, activeTabs, tabGroups])

  const createNewViewGroup = useCallback((tabId?: string, activate = true) => {
    if (activate && !tabId) {
      setActiveGroupId(DEFAULT_VIEW_GROUP_ID)
      setLayoutMode(1)
      setPanes(Array(8).fill(null))
      setFocusedPane(0)
      return DEFAULT_VIEW_GROUP_ID
    }
    const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setViewGroups(prev => {
      const group = createViewGroup(id, prev.filter(item => item.id !== DEFAULT_VIEW_GROUP_ID).length + 1)
      if (tabId) group.panes[0] = tabId
      const defaultGroup = prev.find(item => item.id === DEFAULT_VIEW_GROUP_ID)
      return [...prev.filter(item => item.id !== DEFAULT_VIEW_GROUP_ID), group, ...(defaultGroup ? [defaultGroup] : [])]
    })
    if (tabId) setTabGroups(prev => ({ ...prev, [tabId]: id }))
    if (activate) {
      setActiveGroupId(id)
      setLayoutMode(1)
      const nextPanes = Array(8).fill(null)
      if (tabId) nextPanes[0] = tabId
      setPanes(nextPanes)
      setFocusedPane(0)
    }
    return id
  }, [setFocusedPane, setLayoutMode, setPanes])

  const updateViewGroup = useCallback((groupId: string, patch: Partial<Pick<ViewGroup, 'label' | 'color'>>) => {
    if (groupId === DEFAULT_VIEW_GROUP_ID) return
    setViewGroups(prev => prev.map(group => group.id === groupId ? { ...group, ...patch } : group))
  }, [])

  /** Atomically replace all view groups and switch the active group. Used during session restore. */
  const restoreGroups = useCallback((groups: ViewGroup[], activeId: string) => {
    setViewGroups(groups)
    setActiveGroupId(activeId)
  }, [])

  return { viewGroups, setViewGroups, activeGroupId, tabGroups, setTabGroups, switchViewGroup, createNewViewGroup, updateViewGroup, restoreGroups }
}
