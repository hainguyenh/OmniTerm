import { diag } from '../../diag'
import type { Connection } from '../../domain'
import type { MenuItem } from '../../ide/ui'
import { confirm, showError } from '../../ide/workbench/messages'

import { showSessionTab } from '../sessions/sessionTabActions'
import { useShellPanels } from '../shellPanelsStore'
import { draftFromConnection, draftFromSsh, emptyDraft } from './connectionDraft'
import { openConnectionForm } from './connectionFormStore'
import type { ConnectionNode } from './connectionNodes'

/** The header's "+" menu: a new SSH or Remote Desktop profile for the workspace in scope. */
export function newConnectionMenu(workspaceId: string | null): MenuItem[] {
  return [
    { id: 'new-ssh', label: 'New SSH Connection…', icon: 'file-shell', run: () => openConnectionForm(emptyDraft('SSH'), workspaceId) },
    { id: 'new-rdp', label: 'New Remote Desktop Connection…', icon: 'file-windows', run: () => openConnectionForm(emptyDraft('RDP'), workspaceId) },
  ]
}

/** Deletes a saved profile from its workspace, after asking. */
export async function deleteConnection(connection: Connection): Promise<void> {
  const workspaceId = connection.workspaceId
  if (!workspaceId) return
  const yes = await confirm({
    title: 'Delete Connection',
    message: `Delete "${connection.name}" from this workspace's connections?`,
    ok: 'Delete',
    icon: 'warning',
  })
  if (!yes) return
  try {
    await window.omnitermAPI.workspace.deleteConnection(workspaceId, connection.id)
    await useShellPanels.getState().connections?.onRefresh()
  } catch (error) {
    diag.error('[Connections] could not delete a connection', error)
    await showError('Delete Connection', error instanceof Error ? error.message : String(error))
  }
}

/**
 * The right-click menu of a row. A saved SSH or Remote Desktop profile: Connect, Edit, Delete (a
 * local one is listed but not edited here). An `ssh` typed in a terminal: show that terminal, or
 * save its address as a connection of the workspace in scope.
 */
export function connectionRowMenu(node: ConnectionNode, workspaceId: string | null): MenuItem[] {
  if (node.kind === 'ssh-session') {
    return [
      { id: 'show', label: 'Show Terminal', icon: 'terminal', run: () => showSessionTab(node.session.sessionId) },
      { id: 'save', label: 'Save as Connection…', icon: 'plus', run: () => openConnectionForm(draftFromSsh(node.session), workspaceId) },
    ]
  }
  if (node.kind !== 'connection') return newConnectionMenu(workspaceId)
  const { connection } = node
  const connect: MenuItem = {
    id: 'connect',
    label: 'Connect',
    icon: 'run',
    run: () => useShellPanels.getState().connections?.onConnect(connection),
  }
  if (connection.type === 'LOCAL') return [connect]
  return [
    connect,
    { kind: 'separator' },
    { id: 'edit', label: 'Edit…', icon: 'edit', run: () => openConnectionForm(draftFromConnection(connection), connection.workspaceId ?? workspaceId, true) },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: () => void deleteConnection(connection) },
  ]
}
