import React from 'react'
import type {
  Connection,
  Workspace,
  WorkspaceEntry,
  WorkspaceScript,
} from '@omniterm/contract'

import { entryNode, type WorkspaceTreeNode } from '../utils/scriptTree'
import type { WorkspaceTreeTarget } from '../utils/workspaceFileEdits'
import type { FolderPageInfo } from '../hooks/useWorkspaceScan'
import {
  DEFAULT_FOLDER_FILTER,
  isDefaultFolderFilter,
  type TreeFilter,
} from '../utils/workspaceFilter'
import WorkspaceConnectionRow from './WorkspaceConnectionRow'
import WorkspaceShowMore from './WorkspaceShowMore'
import type { WorkspacePanelView } from './workspacePanelView'
import { WorkspaceFileRow } from './WorkspaceFileRow'
import { WorkspaceFolderRow } from './WorkspaceFolderRow'
import './workspace-file-tree.css'

interface WorkspaceTreeRendererProps {
  workspace: Workspace
  view: WorkspacePanelView
  entries: WorkspaceEntry[]
  connections: Connection[]
  query: string
  flatView: boolean
  filter: TreeFilter
  folderFilters: Record<string, TreeFilter>
  expandedDirs: Set<string>
  loadingFolders: Set<string>
  scanning: boolean
  loadingAll: boolean
  pageInfo: Record<string, FolderPageInfo>
  filesByFolder: Record<string, WorkspaceEntry[]>
  loadingMore: { wsId: string; folder: string } | null
  isPinned: (workspace: Workspace, path: string) => boolean
  onTogglePinned: (workspace: Workspace, path: string) => void
  onToggleDir: (key: string) => void
  onLoadMore: (workspaceId: string, folder: string) => void
  onOpenScript: (workspaceId: string, script: WorkspaceScript) => void
  onRunScript: (workspaceId: string, script: WorkspaceScript) => void
  onOpenTerminal: (workspaceId: string, subPath?: string) => void
  onRenameFolder?: (workspaceId: string, folderId: string, name: string) => void
  onSetFolderPendingRemoval: (pending: { workspaceId: string; folderId: string; name: string }) => void
  onOpenFolderFilterMenu: (
    workspaceId: string,
    folderId: string,
    folderName: string,
    anchor: DOMRect,
    folderPath?: string,
  ) => void
  onNewFile?: (workspaceId: string, folderPath: string, folderName?: string) => void
  onNewFolder?: (target: WorkspaceTreeTarget) => void
  onRenameFile?: (target: WorkspaceTreeTarget, name: string) => void
  onMoveFile?: (target: WorkspaceTreeTarget) => void
  onDeleteFile?: (target: WorkspaceTreeTarget) => void
  /** The file open in the active editor tab, marked until another tab takes focus. */
  activeFile?: { workspaceId: string; path: string } | null
  renderConnectionAction: (workspace: Workspace, parentPath: string, parentLabel: string) => React.ReactNode
  onConnectWorkspaceConnection?: (connection: Connection, workspaceId: string) => void
  onEditWorkspaceConnection?: (workspace: Workspace, parentPath: string, connection: Connection) => void
  onDeleteWorkspaceConnection: (workspaceId: string, connection: Connection) => void
  isHighlighted: (workspaceId: string, path: string) => boolean
  registerRow: (workspaceId: string, path: string) => (el: HTMLDivElement | null) => void
}

const WorkspaceTreeRenderer: React.FC<WorkspaceTreeRendererProps> = ({
  workspace,
  view,
  entries,
  connections,
  query,
  flatView,
  filter,
  folderFilters,
  expandedDirs,
  loadingFolders,
  scanning,
  loadingAll,
  pageInfo,
  filesByFolder,
  loadingMore,
  isPinned,
  onTogglePinned,
  onToggleDir,
  onLoadMore,
  onOpenScript,
  onRunScript,
  onOpenTerminal,
  onRenameFolder,
  onSetFolderPendingRemoval,
  onOpenFolderFilterMenu,
  onNewFile,
  onNewFolder,
  onRenameFile,
  onMoveFile,
  onDeleteFile,
  activeFile,
  renderConnectionAction,
  onConnectWorkspaceConnection,
  onEditWorkspaceConnection,
  onDeleteWorkspaceConnection,
  isHighlighted,
  registerRow,
}) => {
  const wsId = workspace.id

  const fileRow = (node: WorkspaceTreeNode, label: string, depth: number) => {
    const target = { workspaceId: wsId, path: node.path, name: node.name }
    return (
      <WorkspaceFileRow
        key={node.path}
        node={node}
        label={label}
        depth={depth}
        pinned={isPinned(workspace, node.path)}
        highlighted={isHighlighted(wsId, node.path)}
        active={activeFile?.workspaceId === wsId && activeFile.path === node.path}
        rowRef={registerRow(wsId, node.path)}
        onOpen={script => onOpenScript(wsId, script)}
        onRun={script => onRunScript(wsId, script)}
        onTogglePinned={() => onTogglePinned(workspace, node.path)}
        onRename={onRenameFile ? name => onRenameFile(target, name) : undefined}
        onMove={onMoveFile ? () => onMoveFile(target) : undefined}
        onDelete={onDeleteFile ? () => onDeleteFile(target) : undefined}
      />
    )
  }

  const showMoreRow = (folder: string) => {
    const info = pageInfo[folder]
    if (!info?.hasMore) return null
    if (filter.mode !== 'all' && filter.mode !== 'types') return null
    return (
      <WorkspaceShowMore
        wsId={wsId}
        total={info.total}
        loaded={filesByFolder[folder]?.length ?? 0}
        loading={loadingMore?.wsId === wsId && loadingMore?.folder === folder}
        onLoadMore={() => onLoadMore(wsId, folder)}
      />
    )
  }

  const renderNode = (node: WorkspaceTreeNode, depth: number, parentPath: string): React.ReactNode => {
    if (node.connection) {
      return (
        <WorkspaceConnectionRow
          key={node.connection.id}
          connection={node.connection}
          depth={depth}
          onConnect={onConnectWorkspaceConnection
            ? connection => onConnectWorkspaceConnection(connection, wsId)
            : undefined}
          onEdit={onEditWorkspaceConnection
            ? (connection) => onEditWorkspaceConnection(workspace, parentPath, connection)
            : undefined}
          onDelete={(connection) => onDeleteWorkspaceConnection(wsId, connection)}
        />
      )
    }
    if (!node.isDir) return fileRow(node, node.name, depth)
    const key = `${wsId}:${node.path}`
    const expanded = expandedDirs.has(key)
    const rootFolder = depth === 1 ? workspace.folders.find(folder => folder.id === node.path) : undefined
    const name = rootFolder?.name ?? node.name
    const folderFilter = rootFolder
      ? folderFilters[rootFolder.id] ?? DEFAULT_FOLDER_FILTER
      : DEFAULT_FOLDER_FILTER
    return (
      <div key={key} className="workspace-folder-node" data-expanded={expanded} data-root-folder={Boolean(rootFolder)} style={{ '--tree-depth': depth } as React.CSSProperties}>
        <WorkspaceFolderRow
          node={node}
          expanded={expanded}
          loading={loadingFolders.has(key)}
          rootFolder={rootFolder}
          filterActive={Boolean(rootFolder && !isDefaultFolderFilter(folderFilter))}
          pinned={isPinned(workspace, node.path)}
          connectionAction={renderConnectionAction(workspace, node.path, name)}
          onToggle={() => onToggleDir(key)}
          onOpenTerminal={() => onOpenTerminal(wsId, node.path)}
          onTogglePinned={() => onTogglePinned(workspace, node.path)}
          onNewFile={onNewFile ? () => onNewFile(wsId, node.path, name) : undefined}
          onNewFolder={onNewFolder ? () => onNewFolder({ workspaceId: wsId, path: node.path, name }) : undefined}
          onRenameAlias={rootFolder && onRenameFolder
            ? alias => onRenameFolder(wsId, rootFolder.id, alias)
            : undefined}
          onOpenFilterMenu={anchor => {
            if (rootFolder) onOpenFolderFilterMenu(wsId, rootFolder.id, rootFolder.name, anchor, rootFolder.path)
          }}
          onUnlink={() => {
            if (rootFolder) onSetFolderPendingRemoval({ workspaceId: wsId, folderId: rootFolder.id, name: rootFolder.name })
          }}
        />
        {expanded && <>
          {node.children.map((child) => renderNode(child, depth + 1, node.path))}
          {showMoreRow(node.path)}
        </>}
      </div>
    )
  }

  if (view.tree.length === 0) {
    if (scanning || loadingAll) return null
    const empty = entries.length === 0 && connections.length === 0
    return (
      <div className="workspace-tree-empty" role="status">
        {query.trim()
          ? 'Nothing matches your search.'
          : empty
            ? 'This folder is empty.'
            : 'Nothing to show with the current filter.'}
      </div>
    )
  }

  return (
    <>
      {flatView ? (
        (() => {
          const needle = query.trim().toLowerCase()
          const files = view.files
            .filter((entry) => !needle || entry.id.toLowerCase().includes(needle))
            .sort((left, right) => {
              const la = left.id.toLowerCase()
              const lb = right.id.toLowerCase()
              return la < lb ? -1 : la > lb ? 1 : 0
            })
          return files.map((entry) => fileRow(entryNode(entry), entry.id, 1))
        })()
      ) : (
        <>
          {view.tree.map((node) => renderNode(node, 1, ''))}
          {showMoreRow('')}
        </>
      )}
    </>
  )
}
export default WorkspaceTreeRenderer
