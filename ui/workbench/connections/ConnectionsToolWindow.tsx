import { useMemo, useRef, useState } from 'react'

import { EmptyState, IconButton, showContextMenu, Tree } from '../../ide/ui'
import { isAllScope, scopedWorkspaceId, useSelectedWorkspace, useWorkspaceStore } from '../../platform/workspaceStore'

import { useSessionBridge } from '../sessions/sessionBridge'
import { showSessionTab } from '../sessions/sessionTabActions'
import { useShellPanels } from '../shellPanelsStore'
import { connectionRowMenu, newConnectionMenu } from './connectionActions'
import { ConnectionFormDialog } from './ConnectionFormDialog'
import { buildConnectionTree, expandableKeys, isLeaf, nodeLabel, type ActiveSsh, type ConnectionNode } from './connectionNodes'
import { CONNECTION_ROW_CLASS, ConnectionRow } from './ConnectionRow'
import { useLocalSshSessions } from './useLocalSshSessions'

export const CONNECTIONS_TOOL_WINDOW = 'omniterm.connections'

const childrenOf = (node: ConnectionNode) => (isLeaf(node) ? undefined : node.children)

/** The `ssh` sessions typed in terminals, each with its terminal's name. */
function useActiveSsh(): readonly ActiveSsh[] {
  const sessions = useLocalSshSessions()
  const terminals = useSessionBridge((s) => s.sessions)
  return useMemo(
    () => sessions.map((session) => ({ session, terminal: terminals.find((item) => item.id === session.sessionId)?.name ?? '' })),
    [sessions, terminals],
  )
}

/**
 * Saved SSH, Remote Desktop and local connections of the workspace in scope, grouped by type (and
 * by workspace under "All workspaces"), under the `ssh` sessions running unsaved in a terminal.
 * Enter or double-click connects (or shows that terminal); the buttons of a hovered row and its
 * right-click menu connect, edit, delete or save; typing filters the tree.
 */
export function ConnectionsToolWindow() {
  const panel = useShellPanels((s) => s.connections)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const workspaceId = useWorkspaceStore(scopedWorkspaceId)
  const active = useActiveSsh()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const connections = panel?.connections
  const roots = useMemo(
    () => buildConnectionTree(connections ?? [], workspaces, workspaceId, active),
    [connections, workspaces, workspaceId, active],
  )
  const expanded = useMemo(() => new Set(expandableKeys(roots).filter((key) => !collapsed.has(key))), [roots, collapsed])
  if (!panel) return null
  return (
    <>
      <Tree<ConnectionNode>
        roots={roots}
        getKey={(node) => node.key}
        getLabel={nodeLabel}
        getChildren={childrenOf}
        isExpandable={(node) => !isLeaf(node)}
        renderNode={(node, state) => <ConnectionRow node={node} state={state} workspaceId={workspaceId} />}
        rowClassName={() => CONNECTION_ROW_CLASS}
        expanded={expanded}
        onExpandedChange={(_next, node, isExpanded) =>
          setCollapsed((current) => {
            const next = new Set(current)
            if (isExpanded) next.delete(node.key)
            else next.add(node.key)
            return next
          })}
        onActivate={(node) => {
          if (node.kind === 'connection') panel.onConnect(node.connection)
          else if (node.kind === 'ssh-session') showSessionTab(node.session.sessionId)
        }}
        onContextMenu={(node, _selection, event) => {
          event.preventDefault()
          showContextMenu(event, node ? connectionRowMenu(node, workspaceId) : newConnectionMenu(workspaceId))
        }}
        speedSearch
        speedSearchMode="filter"
        aria-label="Connections"
        empty={(
          <EmptyState title="No saved connections">
            {workspaceId ? 'This workspace has no saved connections.' : 'No workspace has saved connections.'}
            {' Use + to add an SSH or Remote Desktop connection.'}
          </EmptyState>
        )}
      />
      <ConnectionFormDialog />
    </>
  )
}

/** The Connections header: the workspace in scope and Refresh. */
export function ConnectionsHeaderActions() {
  const workspace = useSelectedWorkspace()
  const all = useWorkspaceStore(isAllScope)
  const refresh = useShellPanels((s) => s.connections?.onRefresh)
  const label = all ? 'All workspaces' : workspace?.name
  return (
    <>
      {label && (
        <span className="truncate max-w-[12ch] px-1 text-[11px] opacity-60" title={`Connections of ${label}`} data-testid="connections-workspace-label">
          {label}
        </span>
      )}
      <NewConnectionButton />
      <IconButton
        icon="refresh"
        title="Refresh"
        size="small"
        disabled={!refresh}
        onClick={() => void refresh?.()}
        data-testid="connections-refresh-button"
      />
    </>
  )
}

/** "+": a menu of the profile types the workspace in scope can save. */
function NewConnectionButton() {
  const workspaceId = useWorkspaceStore(scopedWorkspaceId)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <IconButton
      ref={ref}
      icon="plus"
      title="New Connection"
      size="small"
      data-testid="connections-new-button"
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect()
        showContextMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 }, newConnectionMenu(workspaceId))
      }}
    />
  )
}
