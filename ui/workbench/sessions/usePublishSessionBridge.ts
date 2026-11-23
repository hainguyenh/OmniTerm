import { useEffect, useMemo, useRef } from 'react'

import type { MainLayoutModel } from '../../components/useMainLayoutController'
import { useTabs } from '../../ide/editor/core/controller'
import { shellLabel } from '../../shellOptions'
import { agentRelaunchCommand } from '../../utils/agentRelaunch'
import { workspaceForConnection } from '../../utils/workspaceIdentity'

import { deriveGrid } from './editorLayoutBridge'
import { useSessionBridge, type SessionBridgeApi, type SessionInfo } from './sessionBridge'
import { syncSessionColors } from './sessionColors'
import { useSessionLive } from './sessionLive'

function sessionInfos(model: MainLayoutModel): SessionInfo[] {
  const workspaces = model.workspaces ?? []
  return model.activeTabs
    .filter((tab) => !model.editorTabs[tab.id])
    .map((tab) => {
      const conn = model.connById(tab.connId)
      return {
        id: tab.id,
        connId: tab.connId,
        name: tab.name,
        connType: conn?.type ?? 'LOCAL',
        // A remote session has no folder: it opens in the workspace shown when it was connected.
        // Tagged with the workspace its profile is saved in, connecting from "All workspaces" (or
        // from another workspace's list) started it with no tab, so Connect looked like it did nothing.
        workspaceId: conn && conn.type !== 'LOCAL' ? null : workspaceForConnection(workspaces, conn)?.id ?? null,
        status: model.statuses[tab.id] ?? 'connecting',
        busy: model.activity[tab.id],
        cwd: model.sessionCwds?.[tab.id] ?? conn?.localCwd ?? null,
        hasCommand: !!conn?.localCommand?.trim(),
        detach: model.detachControl?.stateOf(tab.id) ?? null,
        location: conn ? (conn.type === 'LOCAL' ? model.sessionCwds?.[tab.id] ?? conn.localCwd ?? null : `${conn.user}@${conn.host}:${conn.port}`) : null,
        shellLabel: conn?.type === 'LOCAL' ? shellLabel(model.shellOptions ?? [], conn.shell) : null,
      }
    })
}

/** Where a session like `id` starts: its shell, workspace and current working folder. */
function launchTarget(model: MainLayoutModel, id: string) {
  const tab = model.activeTabs.find((item) => item.id === id)
  const conn = tab ? model.connById(tab.connId) : undefined
  const local = conn?.type === 'LOCAL' ? conn : undefined
  return {
    shell: local?.shell,
    workspaceId: workspaceForConnection(model.workspaces ?? [], conn)?.id ?? model.selectedWorkspaceId,
    cwd: (local ? model.sessionCwds?.[id] ?? local.localCwd : null) ?? null,
  }
}

/**
 * Hands the window's sessions, and the operations on them, to the session editor tabs. The
 * editor lives below the app root and outside React's data flow, so the shell publishes here;
 * nothing else writes. `api` stays one stable object that always reads the latest model.
 */
export function usePublishSessionBridge(model: MainLayoutModel, enabled: boolean): void {
  const latest = useRef(model)
  latest.current = model
  const api = useMemo<SessionBridgeApi>(
    () => ({
      killSession: (id, sessionAlreadyClosed = false) => latest.current.closeTabs([id], true, sessionAlreadyClosed),
      newSessionLike: (id) => {
        const target = launchTarget(latest.current, id)
        latest.current.requestNewSession(target.shell, target.workspaceId, target.cwd)
      },
      duplicateAgent: (id) => {
        const command = agentRelaunchCommand(id)
        if (!command) return
        const target = launchTarget(latest.current, id)
        latest.current.requestNewSession(target.shell, target.workspaceId, target.cwd, command)
      },
      reconnect: (id) => latest.current.reconnectSession(id),
      toggleDetach: (id) => latest.current.detachControl?.toggle(id),
      terminalThemes: (id) => {
        const current = latest.current
        const tab = current.activeTabs.find((item) => item.id === id)
        if (!tab) return null
        const themeId = current.resolveAppearance?.(id, tab.connId)?.themeId ?? current.appSettings.themeId
        return { themes: current.themes.map((theme) => ({ id: theme.id, name: theme.name })), current: themeId }
      },
      applyTerminalTheme: (id, themeId) => {
        const current = latest.current
        const tab = current.activeTabs.find((item) => item.id === id)
        if (tab) current.onThemeApply?.(themeId, { id, connId: tab.connId })
      },
      skipConfirm: () => latest.current.skipCloseConfirmRef.current,
      setSkipConfirm: () => {
        const current = latest.current
        current.skipCloseConfirmRef.current = true
        current.setAppSettings({ ...current.appSettings, skipTerminalCloseConfirm: true })
        void window.omnitermAPI.settings.save({ skipTerminalCloseConfirm: true })
      },
    }),
    [],
  )

  const restoreRequested = useSessionBridge((state) => state.restoreRequested)
  const sessions = enabled ? sessionInfos(model) : null
  const serialized = sessions ? JSON.stringify(sessions) : null
  useEffect(() => {
    if (!enabled || serialized === null) return undefined
    const published = JSON.parse(serialized) as SessionInfo[]
    // Colours first: a tab and its Sessions row never render without one.
    syncSessionColors(published.map((session) => session.id))
    // Same update as the sessions: a restored session never looks unknown to the reconciler.
    useSessionBridge.setState({
      sessions: published,
      api,
      restoreSettled: restoreRequested,
    })
    return undefined
  }, [enabled, serialized, api, restoreRequested])
  const { latencies, metrics, connectedAt } = model
  useEffect(() => {
    if (enabled) useSessionLive.setState({ latencies, metrics, connectedAt })
  }, [enabled, latencies, metrics, connectedAt])
  useEffect(() => {
    if (!enabled) return undefined
    return () => useSessionBridge.setState({ sessions: [], api: null })
  }, [enabled])
}

/**
 * Keeps the legacy pane grid state (what snapshots save as view groups) equal to the editor's
 * layout, so a downgrade still finds each session in a pane. Waits for the restore: until then
 * the grid state holds the layout the snapshot carried, which the reconciler migrates once.
 */
export function useSyncEditorLayout(model: MainLayoutModel, enabled: boolean): void {
  const tabs = useTabs()
  const settled = useSessionBridge((state) => state.restoreSettled)
  const { setPanes, setLayoutMode, setFocusedPane, panes, layoutMode, focusedPane } = model
  const grid = useMemo(() => deriveGrid(tabs), [tabs])
  const gridKey = JSON.stringify(grid)
  const currentKey = JSON.stringify({ layoutMode, panes: panes.slice(0, grid.panes.length), focusedPane })
  const derivedKey = JSON.stringify({ layoutMode: grid.layoutMode, panes: grid.panes, focusedPane: grid.focusedPane })
  useEffect(() => {
    if (!enabled || !settled || currentKey === derivedKey) return
    const derived = JSON.parse(gridKey) as typeof grid
    setPanes(derived.panes)
    setLayoutMode(derived.layoutMode)
    setFocusedPane(derived.focusedPane)
  }, [enabled, settled, currentKey, derivedKey])
}
