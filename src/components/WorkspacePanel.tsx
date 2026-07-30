import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FolderGit2, Folder, ChevronRight, ChevronDown, Terminal, Play, Trash2, Plus, Cable,
} from 'lucide-react'
import type { Connection, Folder as ConnectionFolder, Workspace, WorkspaceEntry, WorkspaceScript } from '@omniterm/contract'
import {
  buildWorkspaceTree, entryNode, filterTreeByQuery, type WorkspaceTreeNode,
} from '../utils/scriptTree'
import {
  DEFAULT_TREE_FILTER, applyFilter, dirsHoldingConnections, type TreeFilter,
} from '../utils/workspaceFilter'
import { fileKindMeta } from '../utils/fileKind'
import { diag } from '../diag'
import { useTreeReveal, type RevealRequest } from '../hooks/useTreeReveal'
import WorkspaceFilterMenu from './WorkspaceFilterMenu'
import WorkspaceTreeToolbar from './WorkspaceTreeToolbar'
import WorkspaceConnectionRow from './WorkspaceConnectionRow'
import WorkspaceSearchBar from './WorkspaceSearchBar'

/**
 * The Workspace view — a left panel (Orca / Antigravity style) for pinning project folders, opening a
 * terminal rooted in one, and browsing what is inside it.
 *
 * A workspace is the *only* home for connections: there is no separate personal list. A saved
 * connection carries the POSIX-relative path of the folder it belongs to in `parentId`, so it renders
 * as a leaf of the tree right next to the scripts it goes with, and the `Cable` button on any folder
 * row creates one there.
 *
 * The tree shows every folder plus, by default, only the runnable files; the filter menu opens that up
 * to every file, a chosen set of types, or a chosen set of files. Clicking a file opens it in the
 * right-side dock (via
 * `onOpenScript`); running is only ever triggered by the explicit run icon.
 *
 * Pure host UI: it renders whatever the active WorkspaceProvider returns over the `workspace:*` IPC
 * bridge, so a plugin can change the data without touching this component.
 */
interface WorkspacePanelProps {
  /** Open an item in the app's right-side dock. */
  onOpenScript: (workspaceId: string, script: WorkspaceScript) => void
  /**
   * Launch an item. Optional: the host owns this so it can pair the run's pane with the file's editor
   * when both are open. Without it the panel runs the script itself and the layout is left alone.
   */
  onRunScript?: (workspaceId: string, script: WorkspaceScript) => void
  /**
   * Report a failed launch. Optional so this panel still renders standalone (tests, embedding), but
   * without it a refused run — a `.rdp` on a platform with no Remote Desktop client, a script that
   * moved out of its workspace — is only visible in the console.
   */
  showAlert?: (message: string, opts?: { title?: string; tone?: 'info' | 'warning' | 'error' }) => Promise<void> | void
  /** Connect to a workspace connection (opens a session in the dock). */
  onConnectWorkspaceConnection?: (conn: Connection) => void
  /** False in a plugin-free build: no provider, so no connection UI at all. */
  hasConnectionProvider?: boolean
  /**
   * Open the connection form for a new connection in `target.parentPath` (`''` = workspace root).
   * `folders` is the workspace's directory tree in the shape the form's Parent Folder select wants,
   * and `rootLabel` is the workspace name it shows instead of a generic "Root".
   */
  onAddWorkspaceConnection?: (target: WorkspaceConnectionTarget) => void
  /** Open the connection form to edit an existing workspace connection. */
  onEditWorkspaceConnection?: (target: WorkspaceConnectionTarget, conn: Connection) => void
  /**
   * Bumped by the host once a workspace connection has been written, so the list reloads.
   *
   * The form that saves one lives in MainLayout, not here, so without a signal a new or edited
   * connection did not appear until the workspace was collapsed and re-expanded.
   */
  connectionsRevision?: number
  /**
   * Bumped by the host (via `nonce`) to expand this file's folders, scroll it into view, and flash a
   * highlight — the target of the active editor tab's "Reveal in tree" button. `path` is workspace-
   * relative (a `WorkspaceScript.id`), matching `WorkspaceTreeNode.path`.
   */
  revealRequest?: RevealRequest | null
}

/** Everything the connection form needs to know about where a connection is being saved. */
export interface WorkspaceConnectionTarget {
  workspaceId: string
  /** POSIX-relative folder path inside the workspace; `''` for the workspace root. */
  parentPath: string
  folders: ConnectionFolder[]
  rootLabel: string
}

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
}) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Everything the scan found: directories and files alike, filtered client-side.
  const [entries, setEntries] = useState<Record<string, WorkspaceEntry[]>>({})
  const [scanning, setScanning] = useState<string | null>(null)
  const [flatView, setFlatView] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  // Workspace connections (loaded from .omniterm/connections.json).
  const [wsConnections, setWsConnections] = useState<Record<string, Connection[]>>({})
  const [query, setQuery] = useState('')
  // Per workspace: in "selected" mode the filter holds workspace-relative file paths, so one shared
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

  const scan = useCallback(async (id: string) => {
    setScanning(id)
    try {
      const [found, conns] = await Promise.all([
        window.omnitermAPI.workspace.scanEntries(id),
        window.omnitermAPI.workspace.loadConnections(id),
      ])
      setEntries((prev) => ({ ...prev, [id]: found }))
      setWsConnections((prev) => ({ ...prev, [id]: conns }))
    } finally {
      setScanning(null)
    }
  }, [])

  const toggle = useCallback((id: string) => {
    // The popover hangs off a row inside the workspace being collapsed, so it must not outlive it.
    setFilterMenu(null)
    setExpandedId((prev) => {
      const next = prev === id ? null : id
      if (next && !entries[next]) void scan(next)
      return next
    })
  }, [entries, scan])

  const addFolder = useCallback(async () => {
    const added = await window.omnitermAPI.workspace.add()
    if (added) {
      await refresh()
      setExpandedId(added.id)
      void scan(added.id)
    }
  }, [refresh, scan])

  const removeFolder = useCallback(async (id: string) => {
    await window.omnitermAPI.workspace.remove(id)
    setExpandedId((prev) => (prev === id ? null : prev))
    await refresh()
  }, [refresh])

  /** Report a rejected launch instead of leaving it as an unhandled promise rejection. */
  const reportFailure = useCallback((err: unknown, title = 'Could not launch') => {
    const message = err instanceof Error ? err.message : String(err)
    if (showAlert) void showAlert(message, { title, tone: 'error' })
    else diag.error(`[WorkspacePanel] ${title}`, err)
  }, [showAlert])

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
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** Collect the collapse keys of every folder node in a tree (depth-first). */
  const collectDirKeys = useCallback((wsId: string, nodes: WorkspaceTreeNode[]): string[] => {
    const keys: string[] = []
    const walk = (n: WorkspaceTreeNode) => {
      if (!n.isDir) return
      keys.push(`${wsId}:${n.path}`)
      n.children.forEach(walk)
    }
    nodes.forEach(walk)
    return keys
  }, [])

  /** The filtered, searched tree for one workspace, plus the folder list the form needs. */
  const viewOf = useMemo(() => {
    const cache = new Map<string, {
      tree: WorkspaceTreeNode[]; folders: ConnectionFolder[]; files: WorkspaceEntry[]
    }>()
    return (wsId: string) => {
      const cached = cache.get(wsId)
      if (cached) return cached
      const all = entries[wsId] ?? []
      const conns = wsConnections[wsId] ?? []
      const kept = applyFilter(all, filterOf(wsId), dirsHoldingConnections(conns.map((c) => c.parentId)))
      const view = {
        tree: filterTreeByQuery(buildWorkspaceTree(kept, conns), query),
        // Every directory the scan found — not just the visible ones, so the form can still target a
        // folder the current filter hides.
        folders: all.filter((e) => e.isDir).map((e) => ({
          id: e.id,
          name: e.name,
          parentId: e.id.includes('/') ? e.id.slice(0, e.id.lastIndexOf('/')) : undefined,
        })),
        // The files the filter admitted, before the search box narrows things further: what the flat
        // view lists, and what the option row's label counts.
        files: kept.filter((e) => !e.isDir),
      }
      cache.set(wsId, view)
      return view
    }
  }, [entries, wsConnections, filterOf, query])

  /**
   * Are all of this workspace's folders collapsed? `null` when the question does not apply — a flat
   * view, or a tree with no folders in it — so the toolbar can leave the button out.
   */
  const collapseStateOf = useCallback((wsId: string): boolean | null => {
    if (flatView) return null
    const keys = collectDirKeys(wsId, viewOf(wsId).tree)
    return keys.length === 0 ? null : keys.every((k) => collapsedDirs.has(k))
  }, [flatView, collectDirKeys, viewOf, collapsedDirs])

  const toggleCollapseAll = useCallback((wsId: string) => {
    const keys = collectDirKeys(wsId, viewOf(wsId).tree)
    const allCollapsed = keys.every((k) => collapsedDirs.has(k))
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      for (const k of keys) allCollapsed ? next.delete(k) : next.add(k)
      return next
    })
  }, [collectDirKeys, viewOf, collapsedDirs])

  // "Reveal in tree" (the active editor tab's Locate icon, see SessionTabs): expand the target's
  // ancestor folders, widen the filter if it would otherwise hide the file, scroll it into view, and
  // flash a highlight.
  const { isHighlighted, registerRow } = useTreeReveal({
    revealRequest, entries, scan, filterOf, setExpandedId, setFlatView, setCollapsedDirs, setFilters,
  })

  /** Where a connection created from `parentPath` in `ws` should be saved. */
  const targetFor = useCallback((ws: Workspace, parentPath: string): WorkspaceConnectionTarget => ({
    workspaceId: ws.id,
    parentPath,
    folders: viewOf(ws.id).folders,
    rootLabel: ws.name,
  }), [viewOf])

  /** The `Cable` action shared by the workspace root row and every folder row. */
  const addConnectionButton = (ws: Workspace, parentPath: string) => {
    if (!hasConnectionProvider || !onAddWorkspaceConnection) return null
    return (
      <button
        type="button"
        title={parentPath ? `Add connection in ${parentPath}` : `Add connection in ${ws.name}`}
        aria-label={parentPath ? `Add connection in ${parentPath}` : `Add connection in ${ws.name}`}
        onClick={(e) => { e.stopPropagation(); onAddWorkspaceConnection(targetFor(ws, parentPath)) }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition"
      >
        <Cable className="w-3.5 h-3.5" />
      </button>
    )
  }

  /**
   * A single file row (tree + flat views); `label` differs (name vs full path). `openable` (a click
   * opens any viewable file) is wider than `script` (the Run icon); neither = dim and inert.
   */
  const fileRow = (wsId: string, node: WorkspaceTreeNode, label: string, depth: number) => {
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

  /** Recursively render a tree node (folder → children; file/connection → row). */
  const renderNode = (ws: Workspace, node: WorkspaceTreeNode, depth: number, parentPath: string): React.ReactNode => {
    if (node.connection) return (
      <WorkspaceConnectionRow
        key={node.connection.id}
        connection={node.connection}
        depth={depth}
        onConnect={onConnectWorkspaceConnection}
        onEdit={onEditWorkspaceConnection
          ? (conn) => onEditWorkspaceConnection(targetFor(ws, parentPath), conn)
          : undefined}
        onDelete={(conn) => deleteConnection(ws.id, conn)}
      />
    )
    if (!node.isDir) return fileRow(ws.id, node, node.name, depth)
    const key = `${ws.id}:${node.path}`
    const collapsed = collapsedDirs.has(key)
    return (
      <div key={key}>
        <div
          className="group flex items-center gap-1 py-1 pr-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggleDir(key)}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />
            : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />}
          <Folder className="w-4 h-4 flex-shrink-0 text-[var(--theme-dim)]" />
          <span className="flex-1 truncate text-xs">{node.name}</span>
          <button
            type="button"
            title="Open terminal here"
            onClick={(e) => { e.stopPropagation(); openTerminal(ws.id, node.path) }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-bg)] transition"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          {addConnectionButton(ws, node.path)}
        </div>
        {!collapsed && node.children.map((c) => renderNode(ws, c, depth + 1, node.path))}
      </div>
    )
  }

  const renderTree = (ws: Workspace) => {
    const { tree } = viewOf(ws.id)
    if (tree.length === 0) {
      if (scanning === ws.id) return null
      const empty = (entries[ws.id] ?? []).length === 0 && (wsConnections[ws.id] ?? []).length === 0
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
      const needle = query.trim().toLowerCase()
      const files = viewOf(ws.id).files
        .filter((e) => !needle || e.id.toLowerCase().includes(needle))
        .sort((a, b) => a.id.localeCompare(b.id))
      // `entryNode`, not an inline object: an added node field must not reach only the tree view.
      return files.map((e) => fileRow(ws.id, entryNode(e), e.id, 1))
    }
    return tree.map((node) => renderNode(ws, node, 1, ''))
  }

  return (
    <div className="flex flex-col h-full text-[var(--theme-fg)] select-none">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--theme-border)]">
        <WorkspaceSearchBar query={query} onChange={setQuery} />
        <button
          type="button"
          title="Add workspace"
          aria-label="Add workspace"
          onClick={() => { void addFolder() }}
          className="flex-shrink-0 p-1 rounded hover:bg-[var(--theme-hover-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.length === 0 && (
          <button
            type="button"
            onClick={addFolder}
            className="mx-3 mt-2 w-[calc(100%-1.5rem)] rounded-md border border-dashed border-[var(--theme-border)] px-3 py-4 text-xs text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:border-[var(--theme-accent)] transition-colors"
          >
            No project folders yet.
            <br />Click to add one.
          </button>
        )}

        {workspaces.map((ws) => {
          const expanded = expandedId === ws.id
          return (
            <div key={ws.id} className="flex flex-col">
              {/* Workspace row */}
              <div
                className="group flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
                onClick={() => toggle(ws.id)}
                title={ws.path}
              >
                {expanded
                  ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />
                  : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />}
                <FolderGit2 className="w-4 h-4 flex-shrink-0 text-[var(--theme-accent)]" />
                <span className="flex-1 truncate text-sm">{ws.name}</span>
                <button
                  type="button"
                  title="Open terminal here"
                  onClick={(e) => { e.stopPropagation(); openTerminal(ws.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition"
                >
                  <Terminal className="w-3.5 h-3.5" />
                </button>
                {addConnectionButton(ws, '')}
                <button
                  type="button"
                  title="Remove from workspaces"
                  onClick={(e) => { e.stopPropagation(); void removeFolder(ws.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-dim)] hover:text-red-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Contents: folders, connections, and whatever files the filter admits */}
              {expanded && (
                <div className="ml-3 mr-1 mb-1">
                  <WorkspaceTreeToolbar
                    filter={filterOf(ws.id)}
                    fileCount={viewOf(ws.id).files.length}
                    onOpenFilterMenu={(anchor) => openFilterMenu(ws.id, anchor)}
                    filterMenuOpen={filterMenu?.workspaceId === ws.id}
                    allCollapsed={collapseStateOf(ws.id)}
                    onToggleCollapseAll={() => toggleCollapseAll(ws.id)}
                    flatView={flatView}
                    onToggleFlatView={() => setFlatView((v) => !v)}
                    scanning={scanning === ws.id}
                    onRescan={() => void scan(ws.id)}
                  />
                  {renderTree(ws)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* One popover for both triggers, mounted outside the scrolling body: it is wider than the
          sidebar, which clips its overflow. */}
      {filterMenu && (
        <WorkspaceFilterMenu
          filter={filterOf(filterMenu.workspaceId)}
          onChange={(next) => setFilters((prev) => ({ ...prev, [filterMenu.workspaceId]: next }))}
          entries={entries[filterMenu.workspaceId] ?? []}
          anchor={filterMenu.anchor}
          onClose={() => setFilterMenu(null)}
        />
      )}
    </div>
  )
}

export default WorkspacePanel
