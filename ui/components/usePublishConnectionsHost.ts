import { useEffect, useMemo, useRef } from 'react'

import type { Connection } from '@omniterm/contract'

import {
  loadWorkspaceConnections,
  setConnectionsHost,
  type ConnectionActions,
} from '../workbench/connections/workspaceConnectionsRoot'
import { selectedWorkspaceId as workspaceIdOf, useWorkspaceStore } from '../platform/workspaceStore'
import type { MainLayoutModel } from './useMainLayoutController'

const lastSegment = (path: string) => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path

/**
 * Lets the Project panel's Connections group and the Connections tool window open and add
 * workspace connections through the shell, and tells them whether a connection provider is on.
 */
export function usePublishConnectionsHost(model: MainLayoutModel): void {
  const { hasConnectionProvider, wsConnectionsRevision } = model
  const latest = useRef(model)
  latest.current = model

  const actions = useMemo<ConnectionActions>(() => ({
    connect: (item) => {
      const { savedConnections = [], handleConnectRef } = latest.current
      // The tree keeps only what it shows; the shell needs the provider's full entry (shell, cwd…).
      const full: Connection = savedConnections.find(
        (c) => c.id === item.id && (!item.workspaceId || !c.workspaceId || c.workspaceId === item.workspaceId),
      ) ?? item
      handleConnectRef.current({ ...full, workspaceId: item.workspaceId ?? full.workspaceId })
    },
    add: () => {
      const { workspaces, selection } = useWorkspaceStore.getState()
      const id = workspaceIdOf(selection)
      const workspace = workspaces.find((item) => item.id === id)
      if (!workspace) return
      const folders = workspace.folders.map((folder) => ({ id: folder.id, name: folder.name || lastSegment(folder.path) }))
      latest.current.setConnFormInitial(undefined)
      latest.current.openConnectionForm({
        workspaceId: workspace.id,
        parentPath: folders[0]?.id ?? '',
        folders,
        rootLabel: workspace.name,
      })
    },
  }), [])

  useEffect(() => {
    setConnectionsHost(Boolean(hasConnectionProvider), actions)
    return () => setConnectionsHost(false, null)
  }, [hasConnectionProvider, actions])

  // A saved or edited connection shows up in the trees at once.
  useEffect(() => {
    if (!wsConnectionsRevision) return
    void loadWorkspaceConnections(workspaceIdOf(useWorkspaceStore.getState().selection))
  }, [wsConnectionsRevision])
}
