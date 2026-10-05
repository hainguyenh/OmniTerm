import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Connection, Workspace, WorkspaceScript } from '@omniterm/contract'
import { areFiltersEqual, useWorkspaceFilters } from '../hooks/useWorkspaceFilters'
import { diag } from '../diag'
import { useTreeReveal } from '../hooks/useTreeReveal'
import { useWorkspaceScan } from '../hooks/useWorkspaceScan'
import { useWorkspaceMutations } from '../hooks/useWorkspaceMutations'
import WorkspaceFilterMenu from './WorkspaceFilterMenu'
import WorkspaceTreeToolbar from './WorkspaceTreeToolbar'
import WorkspacePanelHeader from './WorkspacePanelHeader'
import WorkspaceEmptyState from './WorkspaceEmptyState'
import WorkspaceAddConnectionButton from './WorkspaceAddConnectionButton'
import WorkspaceContainerList from './WorkspaceContainerList'
import WorkspaceTreeRenderer from './WorkspaceTreeRenderer'
import ConfirmDialog from './ConfirmDialog'
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
  const [workspacePendingRemoval, setWorkspacePendingRemoval] = useState<Workspace | null>(null)
  const [folderPendingRemoval, setFolderPendingRemoval] = useState<{
    workspaceId: string
    folderId: string
    name: string
  } | null>(null)
  const {
    folders, files, pageInfo, scanning, loadingMore, loadingAll, loadingFolders,
    scan: scanEntries, loadFolder, loadMore, loadAll, entriesOf,
  } = useWorkspaceScan()
  const [flatView, setFlatView] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [wsConnections, setWsConnections] = useState<Record<string, Connection[]>>({})
  const [query, setQuery] = useState('')
  const {
    setFilters,
    folderFilters,
    projectDefaultFilters,
    filterMenu,
    filterOf,
    getFolderFilter,
    resolvedFolderFilters,
    setWorkspaceFilter,
    setFolderFilter,
    clearFolderFilterOverride,
    setProjectDefaultFilter,
    clearProjectDefaultFilter,
    openFilterMenu,
    openFolderFilterMenu,
    openWorkspaceAppearanceMenu,
    closeFilterMenu,
  } = useWorkspaceFilters(workspaces)

  const refresh = useCallback(async () => {
    setWorkspaces(await window.omnitermAPI.workspace.list())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const reloadConnections = useCallback(async (id: string) => {
    const conns = await window.omnitermAPI.workspace.loadConnections(id)
    setWsConnections((prev) => ({ ...prev, [id]: conns }))
  }, [])

  useEffect(() => {
    if (connectionsRevision === undefined || !expandedId) return
    void reloadConnections(expandedId)
  }, [connectionsRevision, expandedId, reloadConnections])

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

  const rescan = useCallback(async (id: string) => {
    await scanEntries(id)
    await reloadConnections(id)
  }, [scanEntries, reloadConnections])

  const toggle = useCallback((id: string) => {
    closeFilterMenu()
    setExpandedId((prev) => {
      const next = prev === id ? null : id
      if (next && folders[next] === undefined) void scanOnce(next)
      return next
    })
  }, [folders, scanOnce])

  useEffect(() => {
    if (expandedId === null || folders[expandedId] === undefined) return
    const mode = filterOf(expandedId).mode
    if (mode === 'scripts' || mode === 'selected' || flatView) void loadAll(expandedId)
  }, [expandedId, folders, filterOf, flatView, loadAll])

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
    removeFolderFromWorkspace,
    removeWorkspace,
    renameWorkspace,
    renameFolder,
    setWorkspaceAppearance,
    setWorkspaceFolderColor,
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

  const confirmRemoveWorkspace = useCallback(() => {
    if (!workspacePendingRemoval) return
    const workspaceId = workspacePendingRemoval.id
    setWorkspacePendingRemoval(null)
    void removeWorkspace(workspaceId).catch(error => reportFailure(error, 'Could not remove workspace'))
  }, [removeWorkspace, reportFailure, workspacePendingRemoval])

  const confirmUnlinkFolder = useCallback(() => {
    if (!folderPendingRemoval) return
    const { workspaceId, folderId } = folderPendingRemoval
    setFolderPendingRemoval(null)
    void removeFolderFromWorkspace(workspaceId, folderId)
      .catch(error => reportFailure(error, 'Could not unlink folder'))
  }, [folderPendingRemoval, removeFolderFromWorkspace, reportFailure])

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
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Every expanded folder of the open workspace needs its first page. Driven from state rather than
  // from the click: the first scan opens the root folders without a click, and a rescan drops every
  // loaded page while those folders stay open — both used to leave an open folder showing only its
  // subfolders until it was collapsed and expanded again. `loadFolder` skips loaded/in-flight ones.
  useEffect(() => {
    if (expandedId === null || folders[expandedId] === undefined) return
    const prefix = `${expandedId}:`
    for (const key of expandedDirs) {
      if (!key.startsWith(prefix)) continue
      const folder = key.slice(prefix.length)
      if (files[expandedId]?.[folder] !== undefined) continue
      loadFolder(expandedId, folder).catch((err: unknown) => diag.warn('[WorkspacePanel] Could not load folder', err))
    }
  }, [expandedId, expandedDirs, folders, files, loadFolder])

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
        folderFilters: resolvedFolderFilters[wsId] ?? {},
        query,
        expandedDirs,
      })
      cache.set(wsId, view)
      return view
    }
  }, [entriesOf, folders, files, wsConnections, workspaces, filterOf, resolvedFolderFilters, query, expandedDirs])

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
  }, [collectDirKeys, viewOf, expandedDirs])

  const { isHighlighted, registerRow } = useTreeReveal({
    revealRequest, entriesOf, scan: scanOnce, loadFolder, filterOf, setExpandedId, setFlatView,
    setExpandedDirs, setFilters,
  })

  const targetFor = useCallback((ws: Workspace, parentPath: string): WorkspaceConnectionTarget => ({
    workspaceId: ws.id,
    parentPath,
    folders: viewOf(ws.id).folders,
    rootLabel: ws.name,
  }), [viewOf])

  const addConnectionButton = (ws: Workspace, parentPath: string, parentLabel: string) => {
    if (!hasConnectionProvider || !onAddWorkspaceConnection) return null
    const label = `Add connection in ${parentLabel}`
    return <WorkspaceAddConnectionButton label={label} onAdd={() => onAddWorkspaceConnection(targetFor(ws, parentPath))} />
  }

  return (
    <>
      <div
        className="flex flex-col h-full text-[var(--theme-fg)] select-none"
        onContextMenu={event => event.preventDefault()}
      >
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
          onContextMenu={(id, event) => {
            event.preventDefault()
            openWorkspaceAppearanceMenu(id, new DOMRect(event.clientX, event.clientY, 0, 0))
          }}
          onToggle={toggle}
          onAddFolder={id => {
            void addFolderToWorkspace(id).catch(error => reportFailure(error, 'Could not add folder'))
          }}
          onRemove={id => {
            const workspace = workspaces.find(item => item.id === id)
            if (workspace) setWorkspacePendingRemoval(workspace)
            else reportFailure(new Error(`Unknown workspace "${id}"`), 'Could not remove workspace')
          }}
          onRename={(id, name) => { void renameWorkspace(id, name) }}
          onMove={moveWorkspace}
          renderExpanded={ws => {
            const view = viewOf(ws.id)
            return (
              <div className="ml-3 mr-1 mb-1">
                <WorkspaceTreeToolbar
                  filter={filterOf(ws.id)}
                  fileCount={view.files.length}
                  onOpenFilterMenu={(anchor) => openFilterMenu(ws.id, anchor)}
                  filterMenuOpen={filterMenu?.workspaceId === ws.id}
                  allCollapsed={collapseStateOf(ws.id)}
                  onToggleCollapseAll={() => toggleCollapseAll(ws.id)}
                  flatView={flatView}
                  onToggleFlatView={() => setFlatView((value) => !value)}
                  scanning={scanning === ws.id || loadingAll === ws.id}
                  onRescan={() => void rescan(ws.id)}
                />
                <WorkspaceTreeRenderer
                  workspace={ws}
                  view={view}
                  entries={entriesOf(ws.id)}
                  connections={wsConnections[ws.id] ?? []}
                  query={query}
                  flatView={flatView}
                  filter={filterOf(ws.id)}
                  folderFilters={resolvedFolderFilters[ws.id] ?? {}}
                  expandedDirs={expandedDirs}
                  loadingFolders={loadingFolders}
                  scanning={scanning === ws.id}
                  loadingAll={loadingAll === ws.id}
                  pageInfo={pageInfo[ws.id] ?? {}}
                  filesByFolder={files[ws.id] ?? {}}
                  loadingMore={loadingMore}
                  isPinned={isPinned}
                  onTogglePinned={togglePinned}
                  onToggleDir={toggleDir}
                  onLoadMore={(workspaceId, folder) => void loadMore(workspaceId, folder)}
                  onOpenScript={onOpenScript}
                  onRunScript={runScript}
                  onOpenTerminal={openTerminal}
                  onRenameFolder={renameFolder}
                  onSetFolderPendingRemoval={setFolderPendingRemoval}
                  onOpenFolderFilterMenu={openFolderFilterMenu}
                  renderConnectionAction={addConnectionButton}
                  onConnectWorkspaceConnection={onConnectWorkspaceConnection}
                  onEditWorkspaceConnection={(workspace, parentPath, conn) =>
                    onEditWorkspaceConnection?.(targetFor(workspace, parentPath), conn)}
                  onDeleteWorkspaceConnection={deleteConnection}
                  isHighlighted={isHighlighted}
                  registerRow={registerRow}
                />
              </div>
            )
          }}
        />
      </div>

      {filterMenu && (() => {
        const folderKey = filterMenu.folderPath || filterMenu.folderId
        const activeFilter = filterMenu.folderId
          ? getFolderFilter(filterMenu.workspaceId, filterMenu.folderId, filterMenu.folderPath)
          : filterOf(filterMenu.workspaceId)
        const isProjectDefault = Boolean(folderKey && projectDefaultFilters[folderKey] && areFiltersEqual(activeFilter, projectDefaultFilters[folderKey]))
        const hasProjectDefault = Boolean(folderKey && projectDefaultFilters[folderKey] !== undefined)
        return (
          <WorkspaceFilterMenu
            filter={activeFilter}
            onChange={(next) => {
              if (filterMenu.appearanceOnly) return
              if (filterMenu.folderId) {
                setFolderFilter(filterMenu.workspaceId, filterMenu.folderId, next)
              } else {
                setWorkspaceFilter(filterMenu.workspaceId, next)
              }
            }}
            inheritWorkspaceFilter={Boolean(
              !filterMenu.appearanceOnly
              && filterMenu.folderId
              && folderFilters[filterMenu.workspaceId]?.[filterMenu.folderId] === undefined,
            )}
            onApplySameAsWorkspace={!filterMenu.appearanceOnly && filterMenu.folderId
              ? () => clearFolderFilterOverride(filterMenu.workspaceId, filterMenu.folderId!)
              : undefined}
            isProjectDefault={isProjectDefault}
            hasProjectDefault={hasProjectDefault}
            onSaveAsProjectDefault={filterMenu.folderId && folderKey
              ? () => setProjectDefaultFilter(folderKey, activeFilter)
              : undefined}
            onClearProjectDefault={filterMenu.folderId && folderKey && hasProjectDefault
              ? () => clearProjectDefaultFilter(folderKey)
              : undefined}
            entries={filterMenu.appearanceOnly
              ? []
              : filterMenu.folderId
              ? entriesOf(filterMenu.workspaceId).filter(entry =>
                entry.id === filterMenu.folderId || entry.id.startsWith(`${filterMenu.folderId}/`))
              : entriesOf(filterMenu.workspaceId)}
            anchor={filterMenu.anchor}
            onClose={closeFilterMenu}
            title={filterMenu.appearanceOnly
              ? `APPEARANCE ${workspaces.find(workspace => workspace.id === filterMenu.workspaceId)?.name ?? 'Workspace'}`
              : filterMenu.folderId
              ? `FILTER ${filterMenu.folderName ?? filterMenu.folderId} Folder`
              : 'FILTER Workspace'}
            appearanceOnly={filterMenu.appearanceOnly}
            appearanceColor={filterMenu.folderId
              ? workspaces.find(workspace => workspace.id === filterMenu.workspaceId)
                ?.folders.find(folder => folder.id === filterMenu.folderId)?.color
              : workspaces.find(workspace => workspace.id === filterMenu.workspaceId)?.color}
            appearanceIcon={workspaces.find(workspace => workspace.id === filterMenu.workspaceId)?.icon}
            onAppearanceColorChange={filterMenu.appearanceOnly
              ? color => { void setWorkspaceAppearance(filterMenu.workspaceId, color, workspaces.find(workspace => workspace.id === filterMenu.workspaceId)?.icon) }
              : filterMenu.folderId
                ? color => { void setWorkspaceFolderColor(filterMenu.workspaceId, filterMenu.folderId!, color) }
                : undefined}
            onAppearanceIconChange={filterMenu.appearanceOnly
              ? icon => { void setWorkspaceAppearance(filterMenu.workspaceId, workspaces.find(workspace => workspace.id === filterMenu.workspaceId)?.color, icon) }
              : undefined}
          />
        )
      })()}
      </div>
      {workspacePendingRemoval && (
        <ConfirmDialog
          title="Remove workspace?"
          message={`Remove "${workspacePendingRemoval.name}" from workspaces? Its folders will not be deleted.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={confirmRemoveWorkspace}
          onCancel={() => setWorkspacePendingRemoval(null)}
        />
      )}
      {folderPendingRemoval && (
        <ConfirmDialog
          title="Unlink folder?"
          message={`Remove "${folderPendingRemoval.name}" from this workspace? The folder will not be deleted.`}
          confirmLabel="Unlink"
          cancelLabel="Cancel"
          onConfirm={confirmUnlinkFolder}
          onCancel={() => setFolderPendingRemoval(null)}
        />
      )}
    </>
  )
}

export default WorkspacePanel
