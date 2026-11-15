/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectViewRoots } from '../../ide/workbench/contributions'
import { CONNECTIONS_ICON, MONITOR_ICON, PLUG_ICON, SERVER_ICON } from '../shellIcons'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import {
  isConnectionsVisible,
  loadWorkspaceConnections,
  registerWorkspaceConnectionsRoot,
  setConnectionsHost,
  setConnectionsVisibility,
  toggleConnectionsVisibility,
  useWorkspaceConnectionsStore,
} from '../connections/workspaceConnectionsRoot'

describe('workspaceConnectionsRoot', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    setConnectionsVisibility(true)
    setConnectionsHost(true, null)
    useWorkspaceConnectionsStore.getState().setConnections([])
    dispose = registerWorkspaceConnectionsRoot()
  })

  afterEach(() => {
    if (dispose) {
      dispose()
      dispose = null
    }
    useWorkspaceConnectionsStore.getState().setConnections([])
    setConnectionsHost(false, null)
  })

  it('registers omniterm.connections root contribution with the connections icon and order 50', () => {
    const root = useProjectViewRoots.getState().roots.get('omniterm.connections')
    expect(root).toBeDefined()
    expect(root?.label).toBe('Connections')
    expect(root?.icon).toBe(CONNECTIONS_ICON)
    expect(root?.order).toBe(50)
    expect(root?.readOnly).toBe(true)
    expect(root?.children).toBeDefined()
  })

  it('removes the root contribution when visibility is toggled off and restores on toggle on', () => {
    expect(isConnectionsVisible()).toBe(true)
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(true)

    toggleConnectionsVisibility()
    expect(isConnectionsVisible()).toBe(false)
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(false)

    toggleConnectionsVisibility()
    expect(isConnectionsVisible()).toBe(true)
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(true)
  })

  it('shows an add entry while the workspace has no connections', () => {
    const root = useProjectViewRoots.getState().roots.get('omniterm.connections')
    expect(root?.children).toHaveLength(1)
    expect(root?.children?.[0]?.label).toBe('Add connection…')
  })

  it('does not register the root while no connection provider is active', () => {
    setConnectionsHost(false, null)
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(false)
    setConnectionsHost(true, null)
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(true)
  })

  it('groups connection items by kind into child groups with their rows and icons', () => {
    useWorkspaceConnectionsStore.getState().setConnections([
      { id: 'c1', name: 'Dev Server', type: 'SSH', host: '192.168.1.10', port: '22', user: 'root' },
      { id: 'c2', name: 'Desktop', type: 'RDP', host: 'win.local', port: '3390', user: '' },
    ])

    const root = useProjectViewRoots.getState().roots.get('omniterm.connections')
    expect(root?.children?.map((group) => group.label)).toEqual(['SSH', 'Remote Desktop'])
    expect(root?.children?.map((group) => group.icon)).toEqual([SERVER_ICON, MONITOR_ICON])

    const ssh = root?.children?.[0]?.children?.[0]
    expect(ssh?.label).toBe('Dev Server')
    expect(ssh?.icon).toBe(PLUG_ICON)
    expect(ssh?.detail).toBe('root@192.168.1.10')

    const rdp = root?.children?.[1]?.children?.[0]
    expect(rdp?.label).toBe('Desktop')
    expect(rdp?.icon).toBe(MONITOR_ICON)
    expect(rdp?.detail).toBe('win.local:3390')
  })

  it('opens a connection row through the host actions', () => {
    const connect = vi.fn()
    setConnectionsHost(true, { connect, add: vi.fn() })
    const connection = { id: 'c1', name: 'Dev Server', type: 'SSH' as const, host: 'h', port: '22', user: 'u' }
    useWorkspaceConnectionsStore.getState().setConnections([connection])

    const root = useProjectViewRoots.getState().roots.get('omniterm.connections')
    root?.children?.[0]?.children?.[0]?.onOpen?.()
    expect(connect).toHaveBeenCalledWith(connection)
  })

  it('loads connections via omnitermAPI.workspace.loadConnections', async () => {
    const mockConnections = [
      { id: 'conn-1', name: 'Prod SSH', type: 'SSH', host: 'prod.example.com', port: '22', user: 'admin' },
    ]

    const loadConnectionsMock = vi.fn().mockResolvedValue(mockConnections)
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
      workspace: {
        loadConnections: loadConnectionsMock,
      },
    }

    useWorkspaceStore.setState({ selection: 'test-ws::f' })
    try {
      await loadWorkspaceConnections('test-ws')
      expect(loadConnectionsMock).toHaveBeenCalledWith('test-ws')
      expect(useWorkspaceConnectionsStore.getState().connections).toHaveLength(1)
      expect(useWorkspaceConnectionsStore.getState().connections[0]?.name).toBe('Prod SSH')
    } finally {
      delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
    }
  })

  it('drops connections of a workspace the user switched away from while loading', async () => {
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
      workspace: { loadConnections: vi.fn().mockResolvedValue([{ id: 'c', name: 'x', type: 'SSH', host: 'h', port: '22', user: 'u' }]) },
    }
    // Stop the root's own subscription so only the explicit load below runs.
    dispose?.()
    dispose = null
    useWorkspaceConnectionsStore.getState().setConnections([])
    useWorkspaceStore.setState({ selection: 'other::f' })
    try {
      await loadWorkspaceConnections('old-ws')
      expect(useWorkspaceConnectionsStore.getState().connections).toHaveLength(0)
    } finally {
      delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
    }
  })

  it('reloads connections when the selected workspace changes', async () => {
    const load = vi.fn().mockResolvedValue([])
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = { workspace: { loadConnections: load } }
    useWorkspaceStore.setState({ selection: null })
    const dispose = registerWorkspaceConnectionsRoot()
    try {
      useWorkspaceStore.setState({ selection: 'ws-9::f' })
      await vi.waitFor(() => expect(load).toHaveBeenCalledWith('ws-9'))
    } finally {
      dispose()
      delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
    }
  })

  it('unsubscribes and cleans up on dispose', () => {
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(true)
    dispose?.()
    dispose = null
    expect(useProjectViewRoots.getState().roots.has('omniterm.connections')).toBe(false)
  })
})
