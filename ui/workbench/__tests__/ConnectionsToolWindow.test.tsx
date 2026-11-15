/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceStore } from '../../platform/workspaceStore'
import { ConnectionsHeaderActions, ConnectionsToolWindow } from '../connections/ConnectionsToolWindow'
import { setConnectionsHost, useWorkspaceConnectionsStore } from '../connections/workspaceConnectionsRoot'
import { useTreeViewport } from './treeViewport'

describe('ConnectionsToolWindow', () => {
  useTreeViewport()

  const loadConnections = vi.fn()

  beforeEach(() => {
    useWorkspaceConnectionsStore.setState({ connections: [], allConnections: {}, visible: true })
    setConnectionsHost(true, null)
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-1', name: 'herond-dev', folders: [{ id: 'f-1', name: 'x', path: 'C:/x' }] }] as never,
      loaded: true,
      selection: 'ws-1::f',
      scope: 'workspace',
    })
    loadConnections.mockReset()
    loadConnections.mockResolvedValue([
      { id: 'conn-ssh', name: 'my-ssh-server', type: 'SSH', host: '192.168.1.10', port: '22', user: 'root' },
      { id: 'conn-rdp', name: 'windows-box', type: 'RDP', host: '192.168.1.20', port: '3389', user: '' },
      { id: 'conn-local', name: 'local-bash', type: 'LOCAL', host: '', port: '', user: '' },
    ])
    window.omnitermAPI = { ...window.omnitermAPI, workspace: { loadConnections } as never }
  })

  afterEach(() => {
    setConnectionsHost(false, null)
  })

  it('groups the workspace connections by kind and opens a session on double click', async () => {
    const connect = vi.fn()
    setConnectionsHost(true, { connect, add: vi.fn() })

    render(<ConnectionsToolWindow />)

    await waitFor(() => {
      expect(screen.getByText('my-ssh-server')).toBeTruthy()
      expect(screen.getByText('windows-box')).toBeTruthy()
      expect(screen.getByText('local-bash')).toBeTruthy()
    })
    expect(loadConnections).toHaveBeenCalledWith('ws-1')
    expect(screen.getByText('SSH')).toBeTruthy()
    expect(screen.getByText('Remote Desktop')).toBeTruthy()
    expect(screen.getByText('Local shells')).toBeTruthy()
    // The muted detail shows who and where for SSH.
    expect(screen.getByText('root@192.168.1.10')).toBeTruthy()

    fireEvent.doubleClick(screen.getByTestId('connection-row-conn-ssh'))

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-ssh', type: 'SSH' }))
  })

  it('lists every workspace with its own connections under All workspaces', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws-1', name: 'herond-dev', folders: [] },
        { id: 'ws-2', name: 'billing', folders: [] },
        { id: 'ws-3', name: 'empty', folders: [] },
      ] as never,
      scope: 'all',
    })
    loadConnections.mockImplementation(async (id: string) => (
      id === 'ws-1' ? [{ id: 'c1', name: 'dev-box', type: 'SSH', host: 'h1' }]
        : id === 'ws-2' ? [{ id: 'c2', name: 'billing-rdp', type: 'RDP', host: 'h2' }]
          : []
    ))

    render(<ConnectionsToolWindow />)
    render(<ConnectionsHeaderActions />)

    await waitFor(() => {
      expect(screen.getByText('dev-box')).toBeTruthy()
      expect(screen.getByText('billing-rdp')).toBeTruthy()
    })
    expect(screen.getByText('billing')).toBeTruthy()
    expect(screen.queryByText('empty')).toBeNull()
    expect(screen.getByText('All workspaces')).toBeTruthy()
    expect(loadConnections).toHaveBeenCalledWith('ws-3')
  })

  it('opens the add connection form from the header button', () => {
    const add = vi.fn()
    setConnectionsHost(true, { connect: vi.fn(), add })

    render(<ConnectionsHeaderActions />)

    expect(screen.getByText('herond-dev')).toBeTruthy()
    fireEvent.click(screen.getByTestId('connections-add-button'))
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('disables the add button while no connection provider is active', () => {
    setConnectionsHost(false, null)

    render(<ConnectionsHeaderActions />)

    expect((screen.getByTestId('connections-add-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('displays the empty state when the workspace has no connections', async () => {
    loadConnections.mockResolvedValue([])

    render(<ConnectionsToolWindow />)

    await waitFor(() => {
      expect(screen.getByText('No connections in this workspace.')).toBeTruthy()
    })
  })

  it('tells the user to enable a plugin when no connection provider is active', async () => {
    setConnectionsHost(false, null)
    loadConnections.mockResolvedValue([])

    render(<ConnectionsToolWindow />)

    await waitFor(() => {
      expect(screen.getByText(/Enable a connection manager plugin/)).toBeTruthy()
    })
  })
})
