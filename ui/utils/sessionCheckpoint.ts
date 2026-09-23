import type { SessionSnapshot } from './sessionStore'

/**
 * Merge unresolved restore entries into the latest acknowledged checkpoint.
 * Current renderer state wins for entries that completed restoration; pending
 * entries are retained until an explicit user removal clears them.
 */
export function mergePendingSnapshot(
  current: SessionSnapshot,
  pending: SessionSnapshot | null,
): SessionSnapshot {
  if (!pending) return current

  const currentTabIds = new Set(current.activeTabs.map(tab => tab.id))
  const pendingById = new Map(pending.activeTabs.map(tab => [tab.id, tab]))
  const acknowledgedTabs = current.activeTabs.map(tab => {
    const saved = pendingById.get(tab.id)
    if (!saved) return tab
    return { ...tab, recovery: saved.recovery }
  })
  const unresolvedTabs = pending.activeTabs.filter(tab => !currentTabIds.has(tab.id))
  if (unresolvedTabs.length === 0) {
    return { ...current, activeTabs: acknowledgedTabs }
  }

  const unresolvedIds = new Set(unresolvedTabs.map(tab => tab.id))
  const currentConnectionIds = new Set(current.ephemeralConns.map(conn => conn.id))
  const unresolvedConnectionIds = new Set(unresolvedTabs.map(tab => tab.connId))
  const unresolvedConnections = pending.ephemeralConns.filter(conn => {
    return unresolvedConnectionIds.has(conn.id) && !currentConnectionIds.has(conn.id)
  })

  const pendingGroupsById = new Map(pending.viewGroups.map(group => [group.id, group]))
  const mergedGroups = current.viewGroups.map(group => {
    const pendingGroup = pendingGroupsById.get(group.id)
    if (!pendingGroup) return group
    return {
      ...group,
      panes: group.panes.map((pane, index) => {
        if (pane !== null) return pane
        const pendingPane = pendingGroup.panes[index]
        return pendingPane && unresolvedIds.has(pendingPane) ? pendingPane : null
      }),
    }
  })
  const currentGroupIds = new Set(current.viewGroups.map(group => group.id))
  for (const group of pending.viewGroups) {
    if (currentGroupIds.has(group.id)) continue
    mergedGroups.push({
      ...group,
      panes: group.panes.map(pane => pane && unresolvedIds.has(pane) ? pane : null),
    })
  }

  const tabGroups = { ...current.tabGroups }
  for (const tab of unresolvedTabs) {
    const groupId = pending.tabGroups[tab.id]
    if (groupId) tabGroups[tab.id] = groupId
  }

  return {
    ...current,
    activeTabs: [...acknowledgedTabs, ...unresolvedTabs],
    ephemeralConns: [...current.ephemeralConns, ...unresolvedConnections],
    viewGroups: mergedGroups,
    tabGroups,
  }
}

export function selectPendingSnapshotTabs(
  snapshot: SessionSnapshot,
  ids: ReadonlySet<string>,
): SessionSnapshot | null {
  const activeTabs = snapshot.activeTabs.filter(tab => ids.has(tab.id))
  if (activeTabs.length === 0) return null
  const activeIds = new Set(activeTabs.map(tab => tab.id))
  const connectionIds = new Set(activeTabs.map(tab => tab.connId))
  return {
    ...snapshot,
    activeTabs,
    ephemeralConns: snapshot.ephemeralConns.filter(conn => connectionIds.has(conn.id)),
    viewGroups: snapshot.viewGroups.map(group => ({
      ...group,
      panes: group.panes.map(pane => pane && activeIds.has(pane) ? pane : null),
    })),
    tabGroups: Object.fromEntries(
      Object.entries(snapshot.tabGroups).filter(([tabId]) => activeIds.has(tabId)),
    ),
  }
}

export function updatePendingSnapshot(
  previous: SessionSnapshot | null,
  attempt: SessionSnapshot,
  attemptedIds: ReadonlySet<string>,
  unresolvedIds: ReadonlySet<string>,
): SessionSnapshot | null {
  const remaining = previous ? removePendingSnapshotTabs(previous, attemptedIds) : null
  const unresolved = selectPendingSnapshotTabs(attempt, unresolvedIds)
  if (!remaining) return unresolved
  return unresolved ? mergePendingSnapshot(remaining, unresolved) : remaining
}

export function removePendingSnapshotTabs(
  pending: SessionSnapshot | null,
  removedIds: ReadonlySet<string>,
): SessionSnapshot | null {
  if (!pending || removedIds.size === 0) return pending
  const activeTabs = pending.activeTabs.filter(tab => !removedIds.has(tab.id))
  if (activeTabs.length === 0) return null
  const activeIds = new Set(activeTabs.map(tab => tab.id))
  const connectionIds = new Set(activeTabs.map(tab => tab.connId))
  return {
    ...pending,
    activeTabs,
    ephemeralConns: pending.ephemeralConns.filter(conn => connectionIds.has(conn.id)),
    viewGroups: pending.viewGroups.map(group => ({
      ...group,
      panes: group.panes.map(pane => pane && activeIds.has(pane) ? pane : null),
    })),
    tabGroups: Object.fromEntries(
      Object.entries(pending.tabGroups).filter(([tabId]) => activeIds.has(tabId)),
    ),
  }
}
