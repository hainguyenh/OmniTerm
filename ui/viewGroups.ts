import type { LayoutMode } from './themes'

export const VIEW_GROUP_MAX_PLANES = 8
export const DEFAULT_VIEW_GROUP_ID = 'ungrouped'

export interface ViewGroup {
  id: string
  label: string
  color?: string
  persistent?: boolean
  layoutMode: LayoutMode
  panes: (string | null)[]
  focusedPane: number
}

export type ViewGroupPatch = { label?: string; color?: string; persistent?: boolean }

export function notifyViewGroupUpdate(groupId: string, patch: ViewGroupPatch): void {
  window.dispatchEvent(new CustomEvent('omniterm:update-view-group', { detail: { groupId, patch } }))
}

export function notifyViewGroupReorder(sourceId: string, targetId: string, before: boolean): void {
  window.dispatchEvent(new CustomEvent('omniterm:reorder-view-groups', { detail: { sourceId, targetId, before } }))
}

export function notifyViewGroupUngroup(groupId: string): void {
  window.dispatchEvent(new CustomEvent('omniterm:ungroup-view-group', { detail: { groupId } }))
}

export function createViewGroup(id: string, index: number, layoutMode: LayoutMode = 1): ViewGroup {
  return {
    id,
    label: `Desktop ${index}`,
    layoutMode,
    panes: Array(VIEW_GROUP_MAX_PLANES).fill(null),
    focusedPane: 0,
  }
}

export function createDefaultViewGroup(layoutMode: LayoutMode = 1): ViewGroup {
  return {
    ...createViewGroup(DEFAULT_VIEW_GROUP_ID, 0, layoutMode),
    label: 'Ungrouped',
    color: '#6b7280',
    persistent: true,
  }
}

export function groupTabIds(group: ViewGroup): string[] {
  return group.panes.filter((id): id is string => id !== null)
}

export function groupUsedPaneCount(group: ViewGroup): number {
  return groupTabIds(group).length
}

export function visibleTabsForGroup<T extends { id: string }>(
  tabs: T[],
  tabGroups: Record<string, string>,
  activeGroupId: string,
): T[] {
  if (activeGroupId === DEFAULT_VIEW_GROUP_ID || !activeGroupId) {
    return tabs.filter(tab => !tabGroups[tab.id])
  }
  return tabs.filter(tab => tabGroups[tab.id] === activeGroupId)
}
