import { create } from 'zustand'

import type { Connection } from '@omniterm/contract'

import { GROUP_PREFIX } from '../../ide/features/project-tree/model'
import { setExpanded, useProjectTree } from '../../ide/features/project-tree/store'
import {
  registerProjectViewRoot,
  type ProjectViewRootContribution,
  type ProjectViewRootEntry,
} from '../../ide/workbench/contributions'
import { selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { CONNECTIONS_ICON } from '../shellIcons'

import { connectionTree } from './connectionTree'

/** A connection of the selected workspace, as the connection provider stores it. */
export type ConnectionItem = Connection

/** What the shell does with a connection; published by the main layout, which owns sessions. */
export interface ConnectionActions {
  /** Opens a session on the connection in the focused pane. */
  connect: (connection: ConnectionItem) => void
  /** Opens the connection form for the selected workspace. */
  add: () => void
}

interface WorkspaceConnectionsState {
  /** The Project panel's "Connections" group is shown (its toolbar toggle; on by default). */
  visible: boolean
  connections: ConnectionItem[]
  /** Connections of every workspace by id, read while the scope is "All workspaces". */
  allConnections: Readonly<Record<string, ConnectionItem[]>>
  /** A connection provider plugin is enabled: without one there are no connections to show. */
  providerActive: boolean
  actions: ConnectionActions | null
  setVisible: (visible: boolean) => void
  toggleVisible: () => boolean
  setConnections: (connections: ConnectionItem[]) => void
}

export const useWorkspaceConnectionsStore = create<WorkspaceConnectionsState>((set, get) => ({
  visible: true,
  connections: [],
  allConnections: {},
  providerActive: false,
  actions: null,
  setVisible: (visible: boolean) => {
    set({ visible })
    syncContribution()
  },
  toggleVisible: () => {
    const next = !get().visible
    set({ visible: next })
    syncContribution()
    return next
  },
  setConnections: (connections: ConnectionItem[]) => {
    set({ connections })
    syncContribution()
  },
}))

export function isConnectionsVisible(): boolean {
  return useWorkspaceConnectionsStore.getState().visible
}

export function toggleConnectionsVisibility(): boolean {
  return useWorkspaceConnectionsStore.getState().toggleVisible()
}

export function setConnectionsVisibility(visible: boolean): void {
  useWorkspaceConnectionsStore.getState().setVisible(visible)
}

/** Publishes whether a connection provider is on and what connecting does (the main layout calls it). */
export function setConnectionsHost(providerActive: boolean, actions: ConnectionActions | null): void {
  const state = useWorkspaceConnectionsStore.getState()
  if (state.providerActive === providerActive && state.actions === actions) return
  useWorkspaceConnectionsStore.setState({ providerActive, actions })
  syncContribution()
}

/** Opens a session on `connection` through the shell; nothing happens before the shell is up. */
export function openConnection(connection: ConnectionItem): void {
  useWorkspaceConnectionsStore.getState().actions?.connect(connection)
}

/** Opens the connection form for the selected workspace. */
export function addConnection(): void {
  useWorkspaceConnectionsStore.getState().actions?.add()
}

export const CONNECTIONS_ROOT_ID = 'omniterm.connections'
const ROOT_KEY = `${GROUP_PREFIX}${CONNECTIONS_ROOT_ID}`

function selectedWorkspaceName(): string | undefined {
  const { workspaces, selection } = useWorkspaceStore.getState()
  const id = selectedWorkspaceId(selection)
  return workspaces.find((workspace) => workspace.id === id)?.name
}

/** The Project panel's "Connections <workspace>" group: the same rows as the Connections tool window. */
function buildRootContribution(connections: readonly ConnectionItem[]): ProjectViewRootContribution {
  const groups: ProjectViewRootEntry[] = connectionTree(connections).map((group) => ({
    id: group.key,
    label: group.label,
    icon: group.icon,
    bold: true,
    readOnly: true,
    children: (group.children ?? []).map(({ key, label, icon, detail, connection }) => ({
      id: key,
      label,
      icon,
      detail,
      readOnly: true,
      leaf: true,
      onOpen: connection ? () => openConnection(connection) : undefined,
    })),
  }))
  return {
    id: CONNECTIONS_ROOT_ID,
    label: 'Connections',
    icon: CONNECTIONS_ICON,
    detail: selectedWorkspaceName(),
    bold: true,
    order: 50,
    readOnly: true,
    children: groups.length
      ? groups
      : [{ id: 'add', label: 'Add connection…', icon: 'plus', readOnly: true, leaf: true, onOpen: addConnection }],
  }
}

let activeDisposer: (() => void) | null = null
/** Project roots whose Connections group was opened once already: later the user's folding sticks. */
const expandedFor = new Set<string>()

/** Unfolds the group and its kinds the first time a project shows it, like the mock's default. */
function expandOnce(contribution: ProjectViewRootContribution): void {
  const root = useProjectTree.getState().root
  if (!root || expandedFor.has(root)) return
  expandedFor.add(root)
  const keys = [ROOT_KEY, ...(contribution.children ?? []).flatMap((child) => (child.children ? [`${ROOT_KEY}/${child.id}`] : []))]
  setExpanded(new Set([...useProjectTree.getState().expanded, ...keys]))
}

function syncContribution(): void {
  const { visible, connections, providerActive } = useWorkspaceConnectionsStore.getState()

  if (activeDisposer) {
    activeDisposer()
    activeDisposer = null
  }

  if (!visible || !providerActive) return

  const contribution = buildRootContribution(connections)
  activeDisposer = registerProjectViewRoot(contribution)
  expandOnce(contribution)
}

/** A connection read from the provider (untrusted plugin data), or null when it is not one. */
function validConnection(raw: unknown, workspaceId: string): ConnectionItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (c.type !== 'SSH' && c.type !== 'RDP' && c.type !== 'LOCAL') return null
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  // Only the fields the tree shows; connecting looks the full entry up again (see MainLayoutView).
  return {
    id: c.id,
    type: c.type,
    name: text(c.name),
    host: text(c.host),
    port: text(c.port),
    user: text(c.user),
    workspaceId: typeof c.workspaceId === 'string' && c.workspaceId ? c.workspaceId : workspaceId,
  }
}

const inflight = new Map<string, Promise<void>>()

/** Loads the connections of a workspace into the store; concurrent callers for one id share the call. */
export function loadWorkspaceConnections(workspaceId: string | null): Promise<void> {
  if (!workspaceId) {
    useWorkspaceConnectionsStore.getState().setConnections([])
    return Promise.resolve()
  }
  const running = inflight.get(workspaceId)
  if (running) return running
  const load = readConnections(workspaceId).finally(() => inflight.delete(workspaceId))
  inflight.set(workspaceId, load)
  return load
}

/** The validated connections of one workspace; empty when the IPC fails or is absent (tests). */
async function fetchConnections(workspaceId: string): Promise<ConnectionItem[]> {
  try {
    const omnitermAPI = (window as unknown as { omnitermAPI?: { workspace?: { loadConnections: (id: string) => Promise<unknown> } } }).omnitermAPI
    if (!omnitermAPI?.workspace?.loadConnections) return []
    const loaded = await omnitermAPI.workspace.loadConnections(workspaceId)
    const list = Array.isArray(loaded) ? loaded : []
    return list.flatMap((raw) => validConnection(raw, workspaceId) ?? [])
  } catch {
    return []
  }
}

async function readConnections(workspaceId: string): Promise<void> {
  const mapped = await fetchConnections(workspaceId)
  // A saved connection also shows in the "All workspaces" tree once that tree has been read.
  const { allConnections } = useWorkspaceConnectionsStore.getState()
  if (workspaceId in allConnections) {
    useWorkspaceConnectionsStore.setState({ allConnections: { ...allConnections, [workspaceId]: mapped } })
  }
  // The user may have switched workspace while this one was loading.
  if (selectedWorkspaceId(useWorkspaceStore.getState().selection) !== workspaceId) return
  useWorkspaceConnectionsStore.getState().setConnections(mapped)
}

/** Reads the connections of every workspace, for the Connections window's "All workspaces" scope. */
export async function loadAllWorkspaceConnections(workspaceIds: readonly string[]): Promise<void> {
  const lists = await Promise.all(workspaceIds.map(fetchConnections))
  useWorkspaceConnectionsStore.setState({
    allConnections: Object.fromEntries(workspaceIds.map((id, index) => [id, lists[index]])),
  })
}

/**
 * Registers the workspace connections root contribution and keeps it on the selected workspace's
 * connections. Returns an unregister disposer function.
 */
export function registerWorkspaceConnectionsRoot(): () => void {
  syncContribution()

  const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
    const id = selectedWorkspaceId(s.selection)
    if (id !== selectedWorkspaceId(prev.selection)) void loadWorkspaceConnections(id)
    // The group's label carries the workspace name.
    else if (s.workspaces !== prev.workspaces) syncContribution()
  })
  // A newly opened project gets its Connections group unfolded once.
  const unsubscribeTree = useProjectTree.subscribe((s, prev) => {
    if (s.root !== prev.root && activeDisposer) syncContribution()
  })

  // Initial load (the catalog may still be loading: the subscription covers that).
  void loadWorkspaceConnections(selectedWorkspaceId(useWorkspaceStore.getState().selection))

  return () => {
    unsubscribe()
    unsubscribeTree()
    if (activeDisposer) {
      activeDisposer()
      activeDisposer = null
    }
  }
}
