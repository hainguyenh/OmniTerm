import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown, ChevronRight, Folder, Loader2, Pin, PinOff, Play, Terminal,
} from 'lucide-react'
import type { Connection, Workspace, WorkspaceScript } from '@omniterm/contract'
import { entryNode, type WorkspaceTreeNode } from '../utils/scriptTree'
import { DEFAULT_TREE_FILTER, type TreeFilter } from '../utils/workspaceFilter'
import { fileKindMeta } from '../utils/fileKind'
import { diag } from '../diag'
import { useTreeReveal } from '../hooks/useTreeReveal'
import { useWorkspaceScan } from '../hooks/useWorkspaceScan'
import { useWorkspaceMutations } from '../hooks/useWorkspaceMutations'
import WorkspaceFilterMenu from './WorkspaceFilterMenu'
import WorkspaceShowMore from './WorkspaceShowMore'
import WorkspaceTreeToolbar from './WorkspaceTreeToolbar'
import WorkspaceConnectionRow from './WorkspaceConnectionRow'
import WorkspacePanelHeader from './WorkspacePanelHeader'
import WorkspaceEmptyState from './WorkspaceEmptyState'
import WorkspaceAddConnectionButton from './WorkspaceAddConnectionButton'
import WorkspaceContainerList from './WorkspaceContainerList'
import { buildWorkspacePanelView, collectDirKeys } from './workspacePanelView'
import type { WorkspaceConnectionTarget, WorkspacePanelProps } from './workspacePanelTypes'

export type { WorkspaceConnectionTarget } from './workspacePanelTypes'

/**
 * The Workspace view — left panel for pinning project folders, terminal access, and navigation.
 */
const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  onOpenScript,
  onRunScript,
  showAlert,
  onConnectWorkspaceConnection,
  onEditWorkspaceConnection,
  onAddWorkspaceConnection,
  hasConnectionProvider = false,
  connectionsRevision,
  revealRequest,
  onWorkspacesChanged,
}) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // The panel's tree data: the folder skeleton (every directory, shown up front) plus each folder's
  // files, loaded when the folder expands and grown by that folder's own "Show more" row — see
  // useWorkspaceScan. `entriesOf` flattens it back to the scan's entry shape for the tree builder.
  const {
    folders, files, pageInfo, scanning, loadingMore, loadingAll, loadingFolders,
    scan: scanEntries, loadFolder, loadMore, loadAll, entriesOf,
  } = useWorkspaceScan()
  const [flatView, setFlatView] = useState(false)
  // Folders are collapsed until clicked: the tree shows every folder up front, and a folder's files
  // (and any "Show more" row they need) arrive when it is expanded.
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  // Workspace connections (loaded from .omniterm/connections.json).
  const [wsConnections, setWsConnections] = useState<Record<string, Connection[]>>({})
  const [query, setQuery] = useState('')
  // Per workspace: in "selected" mode the filter holds folder-namespaced logical file paths, so one shared
  // filter would leak one project's selection into the next. Persisted to localStorage (matching
  // MainLayout's cc.* UI-state keys) so a chosen filter survives a reload instead of resetting to
  // "scripts only" every time the app opens.
  const [filters, setFilters] = useState<Record<string, TreeFilter>>(() => {
    try {
      const saved = localStorage.getItem('cc.workspaceFilters')
      return saved ? JSON.parse(saved) as Record<string, TreeFilter> : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify(filters))
  }, [filters])
  // Which workspace's filter popover is open, and the trigger rect it hangs from.
  const [filterMenu, setFilterMenu] = useState<{ workspaceId: string; anchor: DOMRect } | null>(null)

  const filterOf = useCallback(
    (wsId: string) => filters[wsId] ?? DEFAULT_TREE_FILTER,
    [filters],
  )

  /** Open the filter popover under `anchor`, or close it if that workspace's menu is already up. */
  const openFilterMenu = useCallback((workspaceId: string, anchor: DOMRect) => {
    setFilterMenu((prev) => (prev?.workspaceId === workspaceId ? null : { workspaceId, anchor }))
  }, [])

  const refresh = useCallback(async () => {
    setWorkspaces(await window.omnitermAPI.workspace.list())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const reloadConnections = useCallback(async (id: string) => {
    const conns = await window.omnitermAPI.workspace.loadConnections(id)
    setWsConnections((prev) => ({ ...prev, [id]: conns }))
  }, [])

  // Pick up a connection the form saved while this panel was open.
  useEffect(() => {
    if (connectionsRevision === undefined || !expandedId) return
    void reloadConnections(expandedId)
  }, [connectionsRevision, expandedId, reloadConnections])

  /** First load of a workspace — no-op once its skeleton is in. */
  const scanOnce = useCallback(async (id: string) => {
    if (folders[id] !== undefined) return
    await scanEntries(id)
    const ws = workspaces.find((w) => w.id === id)
    if (ws) {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        for (const f of ws.folders) next.add(`${id}:${f.id}`)
        return next
      })
    }
    await reloadConnections(id)
  }, [folders, scanEntries, reloadConnections, workspaces])

  /** Forced re-scan — the toolbar's rescan button, and a fresh workspace. */
  const rescan = useCallback(async (id: string) => {
    await scanEntries(id)
    await reloadConnections(id)
  }, [scanEntries, reloadConnections])

  const toggle = useCallback((id: string) => {
    // The popover hangs off a row inside the workspace being collapsed, so it must not outlive it.
    setFilterMenu(null)
    setExpandedId((prev) => {
      const next = prev === id ? null : id
      if (next && folders[next] === undefined) void scanOnce(next)
      return next
    })
  }, [folders, scanOnce])

  // Scripts and selected-file views promise the whole workspace, and the flat view lists every
  // file: none of them may hide anything behind a folder's "Show more" row, so drain every folder
  // completely. The two paged views ("All files", "Selected types") leave folders to page.
  useEffect(() => {
    if (expandedId === null || folders[expandedId] === undefined) return
    const mode = filterOf(expandedId).mode
    if (mode === 'scripts' || mode === 'selected' || flatView) void loadAll(expandedId)
  }, [expandedId, folders, filterOf, flatView, loadAll])

  /** Report a rejected launch instead of leaving it as an unhandled promise rejection. */
  const reportFailure = useCallback((err: unknown, title = 'Could not launch') => {
    const message = err instanceof Error ? err.message : String(err)
    if (showAlert) void showAlert(message, { title, tone: 'error' })
    else diag.error(`[WorkspacePanel] ${title}`, err)
  }, [showAlert])

  const {
    addFolderToWorkspace,
    addWorkspace,
    createWorkspace,
    importWorkspace,
    isPinned,
    moveWorkspace,
    removeWorkspace,
    renameWorkspace,
    togglePinned,
  } = useWorkspaceMutations({
    onWorkspacesChanged,
    refresh,
    rescan,
    scanOnce,
    reportFailure,
    setExpandedId,
    setWorkspaces,
  })

  const openTerminal = useCallback((id: string, subPath?: string) => {
    void window.omnitermAPI.workspace
      .run(subPath ? { workspaceId: id, subPath } : { workspaceId: id })
      .catch(reportFailure)
  }, [reportFailure])

  const runScript = useCallback((id: string, script: WorkspaceScript) => {
    if (onRunScript) return onRunScript(id, script)
    void window.omnitermAPI.workspace.run({ workspaceId: id, script }).catch(reportFailure)
  }, [onRunScript, reportFailure])

  const deleteConnection = useCallback((wsId: string, conn: Connection) => {
    // Only drop the row once the delete landed, so a refused write does not leave the list claiming
    // the connection is gone.
    void window.omnitermAPI.workspace.deleteConnection(wsId, conn.id)
      .then(() => {
        setWsConnections((prev) => ({
          ...prev,
          [wsId]: (prev[wsId] ?? []).filter((c) => c.id !== conn.id),
        }))
      })
      .catch((err) => reportFailure(err, 'Could not delete'))
  }, [reportFailure])

  const toggleDir = useCallback((key: string) => {
    const wasExpanded = expandedDirs.has(key)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // Expanding a folder is the moment its files are asked for — the tree only loads what is open.
    if (!wasExpanded) {
      const slash = key.indexOf(':')
      void loadFolder(key.slice(0, slash), key.slice(slash + 1))
    }
  }, [expandedDirs, loadFolder])

  /** The filtered, searched tree for one workspace, plus the folder list the form needs. */
  const viewOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof buildWorkspacePanelView>>()
    return (wsId: string) => {
      const cached = cache.get(wsId)
      if (cached) return cached
      const view = buildWorkspacePanelView({
        workspaceId: wsId,
        entries: entriesOf(wsId),
        connections: wsConnections[wsId] ?? [],
        pins: workspaces.find(workspace => workspace.id === wsId)?.pins ?? [],
        rootFolders: workspaces.find(workspace => workspace.id === wsId)?.folders ?? [],
        filesByFolder: files[wsId] ?? {},
        filter: filterOf(wsId),
        query,
        expandedDirs,
      })
      cache.set(wsId, view)
      return view
    }
  }, [entriesOf, folders, files, wsConnections, workspaces, filterOf, query, expandedDirs])

  /**
   * Are all of this workspace's folders collapsed? `null` when the question does not apply — a flat
   * view, or a tree with no folders in it — so the toolbar can leave the button out.
   */
  const collapseStateOf = useCallback((wsId: string): boolean | null => {
    if (flatView) return null
    const keys = collectDirKeys(wsId, viewOf(wsId).tree)
    return keys.length === 0 ? null : keys.every((k) => !expandedDirs.has(k))
  }, [flatView, collectDirKeys, viewOf, expandedDirs])

  const toggleCollapseAll = useCallback((wsId: string) => {
    const keys = collectDirKeys(wsId, viewOf(wsId).tree)
    const allCollapsed = keys.every((k) => !expandedDirs.has(k))
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      for (const k of keys) allCollapsed ? next.add(k) : next.delete(k)
      return next
    })
    // Expanding every folder at once must ask for every folder's files, or the rows would be empty.
    if (allCollapsed) {
      for (const k of keys) {
        const slash = k.indexOf(':')
        void loadFolder(k.slice(0, slash), k.slice(slash + 1))
      }
    }
  }, [collectDirKeys, viewOf, expandedDirs, loadFolder])

  // "Reveal in tree" (the active editor tab's Locate icon, see SessionTabs): expand the target's
  // ancestor folders, widen the filter if it would otherwise hide the file, scroll it into view, and
  // flash a highlight.
  const { isHighlighted, registerRow } = useTreeReveal({
    revealRequest, entriesOf, scan: scanOnce, loadFolder, filterOf, setExpandedId, setFlatView,
    setExpandedDirs, setFilters,
  })

  /** Where a connection created from `parentPath` in `ws` should be saved. */
  const targetFor = useCallback((ws: Workspace, parentPath: string): WorkspaceConnectionTarget => ({
    workspaceId: ws.id,
    parentPath,
    folders: viewOf(ws.id).folders,
    rootLabel: ws.name,
  }), [viewOf])

  /** The `Cable` action for a real workspace folder row. */
  const addConnectionButton = (ws: Workspace, parentPath: string, parentLabel: string) => {
    if (!hasConnectionProvider || !onAddWorkspaceConnection) return null
    const label = `Add connection in ${parentLabel}`
    return <WorkspaceAddConnectionButton label={label} onAdd={() => onAddWorkspaceConnection(targetFor(ws, parentPath))} />
  }

  /**
   * A single file row (tree + flat views); `label` differs (name vs full path). `openable` (a click
   * opens any viewable file) is wider than `script` (the Run icon); neither = dim and inert.
   */
  const fileRow = (ws: Workspace, node: WorkspaceTreeNode, label: string, depth: number) => {
    const wsId = ws.id
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
        <button
          type="button"
          title={isPinned(ws, node.path) ? 'Unpin item' : 'Pin item'}
          onClick={event => { event.stopPropagation(); togglePinned(ws, node.path) }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
        >
          {isPinned(ws, node.path) ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
        {script && (
          <button
            type="button"
            title={script.kind === 'rdp' ? 'Launch' : 'Run'}
            onClick={(e) => { e.stopPropagation(); runScript(wsId, script) }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }

  const renderNode = (ws: Workspace, node: WorkspaceTreeNode, depth: number, parentPath: string): React.ReactNode => {
    if (node.connection) return (
      <WorkspaceConnectionRow
        key={node.connection.id}
        connection={node.connection}
        depth={depth}
        onConnect={(connection) => onConnectWorkspaceConnection?.(connection, ws.id)}
        onEdit={onEditWorkspaceConnection
          ? (conn) => onEditWorkspaceConnection(targetFor(ws, parentPath), conn)
          : undefined}
        onDelete={(conn) => deleteConnection(ws.id, conn)}
      />
    )
    if (!node.isDir) return fileRow(ws, node, node.name, depth)
    const key = `${ws.id}:${node.path}`
    const expanded = expandedDirs.has(key)
    const Chevron = expanded && loadingFolders.has(key) ? Loader2 : expanded ? ChevronDown : ChevronRight
    return (
      <div key={key}>
        <div
          className="group flex items-center gap-1 py-1 pr-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggleDir(key)}
        >
          <Chevron className={`w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)] ${expanded && loadingFolders.has(key) ? 'animate-spin' : ''}`} />
          <Folder className="w-4 h-4 flex-shrink-0 text-[var(--theme-dim)]" />
          <span className="flex-1 truncate text-xs">{node.name}</span>
          <button
            type="button"
            title={isPinned(ws, node.path) ? 'Unpin item' : 'Pin item'}
            onClick={event => { event.stopPropagation(); togglePinned(ws, node.path) }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
          >
            {isPinned(ws, node.path) ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            title="Open terminal here"
            onClick={(e) => { e.stopPropagation(); openTerminal(ws.id, node.path) }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-bg)] transition"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          {addConnectionButton(ws, node.path, node.name)}
        </div>
        {expanded && <>
          {node.children.map((c) => renderNode(ws, c, depth + 1, node.path))}
          {showMoreRow(ws.id, node.path)}
        </>}
      </div>
    )
  }

  /**
   * One folder's "Show more" row — the tree's only paging, and it belongs to the folder, not the
   * workspace. Shown for the filters that browse the whole tree ("All files", "Selected types")
   * only: scripts and file selections are fully loaded instead (see the `loadAll` effect), so a
   * paging row there would claim something was missing when nothing is.
   */
  const showMoreRow = (wsId: string, folder: string) => {
    const info = pageInfo[wsId]?.[folder]
    if (!info?.hasMore) return null
    const mode = filterOf(wsId).mode
    if (mode !== 'all' && mode !== 'types') return null
    return (
      <WorkspaceShowMore
        wsId={wsId}
        total={info.total}
        loaded={files[wsId]?.[folder]?.length ?? 0}
        loading={loadingMore?.wsId === wsId && loadingMore?.folder === folder}
        onLoadMore={() => loadMore(wsId, folder)}
      />
    )
  }

  const renderTree = (ws: Workspace) => {
    const { tree } = viewOf(ws.id)
    if (tree.length === 0) {
      // Draining (loadingAll) can transiently empty the tree between batches — not "nothing matches".
      if (scanning === ws.id || loadingAll === ws.id) return null
      const empty = entriesOf(ws.id).length === 0 && (wsConnections[ws.id] ?? []).length === 0
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
      // Flattened: every file the filter admitted in one list, labelled by its relative path. Folders
      // and connections stay out of it — a flat list of connections has no folder context left to show.
      // No "Show more" row: the flat view drains every folder via `loadAll`, so it is complete.
      const needle = query.trim().toLowerCase()
      const files = viewOf(ws.id).files
        .filter((e) => !needle || e.id.toLowerCase().includes(needle))
        .sort((a, b) => a.id.localeCompare(b.id))
      // `entryNode`, not an inline object: an added node field must not reach only the tree view.
      return <>{files.map((e) => fileRow(ws, entryNode(e), e.id, 1))}</>
    }
    return <>{tree.map((node) => renderNode(ws, node, 1, ''))}{showMoreRow(ws.id, '')}</>
  }

  return (
    <div className="flex flex-col h-full text-[var(--theme-fg)] select-none">
      <WorkspacePanelHeader
        query={query}
        onQueryChange={setQuery}
        onImport={() => { void importWorkspace().catch(error => reportFailure(error, 'Could not import workspace')) }}
        onCreate={name => { void createWorkspace(name).catch(error => reportFailure(error, 'Could not create workspace')) }}
        onAdd={() => { void addWorkspace().catch(error => reportFailure(error, 'Could not add workspace')) }}
      />

      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.length === 0 && (
          <WorkspaceEmptyState
            onAdd={() => { void addWorkspace().catch(error => reportFailure(error, 'Could not add workspace')) }}
          />
        )}

        <WorkspaceContainerList
          workspaces={workspaces}
          expandedId={expandedId}
          renderConnectionAction={ws => addConnectionButton(ws, '', ws.name)}
          onToggle={toggle}
          onAddFolder={id => {
            void addFolderToWorkspace(id).catch(error => reportFailure(error, 'Could not add folder'))
          }}
          onRemove={id => { void removeWorkspace(id).catch(error => reportFailure(error, 'Could not remove workspace')) }}
          onRename={(id, name) => { void renameWorkspace(id, name) }}
          onMove={moveWorkspace}
          renderExpanded={ws => (
            <div className="ml-3 mr-1 mb-1">
              <WorkspaceTreeToolbar
                filter={filterOf(ws.id)}
                fileCount={viewOf(ws.id).files.length}
                onOpenFilterMenu={(anchor) => openFilterMenu(ws.id, anchor)}
                filterMenuOpen={filterMenu?.workspaceId === ws.id}
                allCollapsed={collapseStateOf(ws.id)}
                onToggleCollapseAll={() => toggleCollapseAll(ws.id)}
                flatView={flatView}
                onToggleFlatView={() => setFlatView((value) => !value)}
                scanning={scanning === ws.id || loadingAll === ws.id}
                onRescan={() => void rescan(ws.id)}
              />
              {renderTree(ws)}
            </div>
          )}
        />
      </div>

      {filterMenu && (
        <WorkspaceFilterMenu
          filter={filterOf(filterMenu.workspaceId)}
          onChange={(next) => setFilters((prev) => ({ ...prev, [filterMenu.workspaceId]: next }))}
          entries={entriesOf(filterMenu.workspaceId)}
          anchor={filterMenu.anchor}
          onClose={() => setFilterMenu(null)}
        />
      )}
    </div>
  )
}

export default WorkspacePanel
