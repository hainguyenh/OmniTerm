import React from 'react'
import {
  ChevronDown, ChevronRight, Filter, Folder, Loader2, Pin, PinOff, Play, Terminal, Unlink,
} from 'lucide-react'
import type {
  Connection,
  Workspace,
  WorkspaceEntry,
  WorkspaceScript,
} from '@omniterm/contract'
import { entryNode, type WorkspaceTreeNode } from '../utils/scriptTree'
import { fileKindMeta } from '../utils/fileKind'
import type { FolderPageInfo } from '../hooks/useWorkspaceScan'
import {
  DEFAULT_FOLDER_FILTER,
  isDefaultFolderFilter,
  type TreeFilter,
} from '../utils/workspaceFilter'
import { WORKSPACE_COLOR_VALUES } from '../utils/workspaceAppearance'
import WorkspaceConnectionRow from './WorkspaceConnectionRow'
import WorkspaceShowMore from './WorkspaceShowMore'
import type { WorkspacePanelView } from './workspacePanelView'
import { Tooltip } from './Tooltip'

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
  onSetFolderPendingRemoval: (pending: { workspaceId: string; folderId: string; name: string }) => void
  onOpenFolderFilterMenu: (
    workspaceId: string,
    folderId: string,
    folderName: string,
    anchor: DOMRect,
  ) => void
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
  onSetFolderPendingRemoval,
  onOpenFolderFilterMenu,
  renderConnectionAction,
  onConnectWorkspaceConnection,
  onEditWorkspaceConnection,
  onDeleteWorkspaceConnection,
  isHighlighted,
  registerRow,
}) => {
  const fileRow = (node: WorkspaceTreeNode, label: string, depth: number) => {
    const wsId = workspace.id
    const meta = fileKindMeta(node.entry?.kind ?? '')
    const Icon = meta.icon
    const { script, openable } = node
    const verb = openable?.editable ? 'View / edit' : openable ? 'View' : ''
    const title = verb ? `${verb} ${node.name}` : `${node.name} (${meta.label})`
    const highlighted = isHighlighted(wsId, node.path)
    return (
      <div
        key={node.path}
        ref={registerRow(wsId, node.path)}
        className={`group flex items-center gap-2 pr-1 py-1 rounded hover:bg-[var(--theme-hover-bg)] ${openable ? 'cursor-pointer' : 'cursor-default'} ${
          highlighted ? 'bg-[var(--theme-accent)]/20 ring-1 ring-[var(--theme-accent)]' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => { if (openable) onOpenScript(wsId, openable) }}
        title={title}
      >
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} />
        <span className={`flex-1 truncate text-xs ${openable ? '' : 'text-[var(--theme-dim)]'}`}>{label}</span>
        <Tooltip content={isPinned(workspace, node.path) ? 'Unpin item' : 'Pin item'} placement="bottom">
          <button
            type="button"
            aria-label={isPinned(workspace, node.path) ? 'Unpin item' : 'Pin item'}
            onClick={event => { event.stopPropagation(); onTogglePinned(workspace, node.path) }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
          >
            {isPinned(workspace, node.path)
              ? <PinOff className="w-3.5 h-3.5" />
              : <Pin className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
        {script && (
          <Tooltip content={script.kind === 'rdp' ? 'Launch' : 'Run'} placement="bottom">
            <button
              type="button"
              aria-label={script.kind === 'rdp' ? 'Launch' : 'Run'}
              onClick={event => { event.stopPropagation(); onRunScript(wsId, script) }}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }

  const showMoreRow = (folder: string) => {
    const info = pageInfo[folder]
    if (!info?.hasMore) return null
    if (filter.mode !== 'all' && filter.mode !== 'types') return null
    return (
      <WorkspaceShowMore
        wsId={workspace.id}
        total={info.total}
        loaded={filesByFolder[folder]?.length ?? 0}
        loading={loadingMore?.wsId === workspace.id && loadingMore?.folder === folder}
        onLoadMore={() => onLoadMore(workspace.id, folder)}
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
          onConnect={(connection) => onConnectWorkspaceConnection?.(connection, workspace.id)}
          onEdit={onEditWorkspaceConnection
            ? (connection) => onEditWorkspaceConnection(workspace, parentPath, connection)
            : undefined}
          onDelete={(connection) => onDeleteWorkspaceConnection(workspace.id, connection)}
        />
      )
    }
    if (!node.isDir) return fileRow(node, node.name, depth)
    const key = `${workspace.id}:${node.path}`
    const expanded = expandedDirs.has(key)
    const Chevron = expanded && loadingFolders.has(key) ? Loader2 : expanded ? ChevronDown : ChevronRight
    const rootFolder = depth === 1 ? workspace.folders.find(folder => folder.id === node.path) : undefined
    const pinned = isPinned(workspace, node.path)
    const folderFilter = rootFolder
      ? folderFilters[rootFolder.id] ?? DEFAULT_FOLDER_FILTER
      : DEFAULT_FOLDER_FILTER
    const folderFilterActive = Boolean(rootFolder && !isDefaultFolderFilter(folderFilter))
    return (
      <div key={key}>
        <div
          className="group flex items-center gap-1 py-1 pr-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onToggleDir(key)}
          onContextMenu={event => {
            if (!rootFolder) return
            event.preventDefault()
            onOpenFolderFilterMenu(
              workspace.id,
              rootFolder.id,
              rootFolder.name,
              new DOMRect(event.clientX, event.clientY, 0, 0),
            )
          }}
        >
          <Chevron className={`w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)] ${expanded && loadingFolders.has(key) ? 'animate-spin' : ''}`} />
          {folderFilterActive && (
            <Filter
              className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-accent)]"
              aria-label="Folder filter active"
            />
          )}
          <Folder
            className="w-4 h-4 flex-shrink-0"
            style={{ color: rootFolder?.color ? WORKSPACE_COLOR_VALUES[rootFolder.color] : 'var(--theme-dim)' }}
          />
          <span className="flex-1 truncate text-xs">{node.name}</span>
          {pinned ? (
            <Tooltip content="Unpin item" placement="bottom">
              <button
                type="button"
                aria-label="Unpin item"
                onClick={event => { event.stopPropagation(); onTogglePinned(workspace, node.path) }}
                className="flex-shrink-0 rounded p-1 text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
              >
                <Pin className="w-3.5 h-3.5" aria-label="Pinned folder" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Pin item" placement="bottom">
              <button
                type="button"
                aria-label="Pin item"
                onClick={event => { event.stopPropagation(); onTogglePinned(workspace, node.path) }}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          {rootFolder && (
            <Tooltip content="Unlink folder from workspace" placement="bottom">
              <button
                type="button"
                aria-label="Unlink folder from workspace"
                onClick={event => {
                  event.stopPropagation()
                  onSetFolderPendingRemoval({
                    workspaceId: workspace.id,
                    folderId: rootFolder.id,
                    name: rootFolder.name,
                  })
                }}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-red-400 hover:bg-[var(--theme-bg)] transition"
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Open terminal here" placement="bottom">
            <button
              type="button"
              aria-label="Open terminal here"
              onClick={event => { event.stopPropagation(); onOpenTerminal(workspace.id, node.path) }}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-bg)] transition"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          {renderConnectionAction(workspace, node.path, node.name)}
        </div>
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
      <div className="px-2 py-1 text-xs text-[var(--theme-dim)] italic" style={{ paddingLeft: 20 }}>
        {query.trim()
          ? 'Nothing matches your search.'
          : empty
            ? 'This folder is empty.'
            : 'Nothing to show with the current filter.'}
      </div>
    )
  }

  if (flatView) {
    const needle = query.trim().toLowerCase()
    const files = view.files
      .filter((entry) => !needle || entry.id.toLowerCase().includes(needle))
      .sort((left, right) => left.id.localeCompare(right.id))
    return <>{files.map((entry) => fileRow(entryNode(entry), entry.id, 1))}</>
  }

  return <>{view.tree.map((node) => renderNode(node, 1, ''))}{showMoreRow('')}</>
}
export default WorkspaceTreeRenderer
