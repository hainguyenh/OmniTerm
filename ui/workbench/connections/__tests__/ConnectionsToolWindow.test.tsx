/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Connection, Workspace } from '../../../domain'
import { diag } from '../../../diag'
import { useWorkspaceStore } from '../../../platform/workspaceStore'
import { encodeWorkspaceSelection } from '../../../utils/workspaceSelection'

import { useShellPanels } from '../../shellPanelsStore'
import { ConnectionsHeaderActions, ConnectionsToolWindow } from '../ConnectionsToolWindow'
import { nodeDetail } from '../connectionNodes'
import { loadSavedConnections } from '../loadSavedConnections'
import { usePublishConnections } from '../usePublishConnections'

const conn = (over: Partial<Connection>): Connection => ({
  id: 'c', name: 'c', type: 'SSH', host: 'h', port: '', user: '', workspaceId: 'w1', ...over,
})

const WORKSPACES = [
  { id: 'w1', name: 'Work', folders: [] },
  { id: 'w2', name: 'Home', folders: [] },
] as unknown as Workspace[]

const CONNECTIONS = [
  conn({ id: 'web', name: 'web-01', host: 'web.example', user: 'deploy', port: '2222' }),
  conn({ id: 'db', name: 'db-01', host: 'db.example', user: 'admin', port: '22' }),
  conn({ id: 'desk', name: 'Desktop', type: 'RDP', host: 'pc.example', port: '3389' }),
  conn({ id: 'wsl', name: 'Ubuntu', type: 'LOCAL', host: '', shell: 'wsl', localCwd: '~/src' }),
  conn({ id: 'nas', name: 'nas', host: 'nas.home', workspaceId: 'w2' }),
]

function publish(connections: readonly Connection[] = CONNECTIONS) {
  const onConnect = vi.fn()
  const onRefresh = vi.fn(async () => undefined)
  act(() => useShellPanels.setState({ connections: { connections, onConnect, onRefresh } }))
  return { onConnect, onRefresh }
}

const labels = () => screen.queryAllByRole('treeitem').map((row) => row.textContent)
const row = (name: string) => screen.getAllByRole('treeitem').find((item) => item.textContent?.startsWith(name))!

describe('Connections tool window', () => {
  beforeEach(() => {
    // The tree is virtualised: give its viewport a size so jsdom mounts the rows.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    act(() => {
      useShellPanels.setState({ connections: null })
      useWorkspaceStore.setState({ workspaces: WORKSPACES, selection: encodeWorkspaceSelection('w1'), scope: 'workspace' })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows nothing until the shell publishes the connections', () => {
    const { container } = render(<ConnectionsToolWindow />)
    expect(container.innerHTML).toBe('')
  })

  it('lists the workspace connections grouped by type with their address', () => {
    publish()
    render(<ConnectionsToolWindow />)
    expect(labels()).toEqual([
      'SSH2',
      'db-01admin@db.example',
      'web-01deploy@web.example:2222',
      'Remote Desktop1',
      'Desktoppc.example',
      'Local1',
      'Ubuntuwsl · ~/src',
    ])
  })

  it('connects on double-click and on Enter, but not on a group', () => {
    const { onConnect } = publish()
    render(<ConnectionsToolWindow />)
    fireEvent.doubleClick(row('web-01'))
    expect(onConnect).toHaveBeenCalledWith(CONNECTIONS[0])
    fireEvent.mouseDown(row('Desktop'), { button: 0 })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Enter' })
    expect(onConnect).toHaveBeenLastCalledWith(CONNECTIONS[2])
    fireEvent.doubleClick(row('SSH'))
    expect(onConnect).toHaveBeenCalledTimes(2)
  })

  it('folds and unfolds a group', () => {
    publish()
    render(<ConnectionsToolWindow />)
    const toggle = () => row('SSH').querySelector('[data-tree-toggle]')!
    fireEvent.mouseDown(toggle(), { button: 0 })
    expect(labels()).not.toContain('web-01deploy@web.example:2222')
    fireEvent.mouseDown(toggle(), { button: 0 })
    expect(labels()).toContain('web-01deploy@web.example:2222')
  })

  it('groups by workspace under All workspaces', () => {
    act(() => useWorkspaceStore.setState({ scope: 'all' }))
    publish()
    render(<ConnectionsToolWindow />)
    expect(labels()[0]).toBe('Work4')
    expect(labels()).toContain('Home1')
    expect(labels()).toContain('nasnas.home')
  })

  it('says so when there are no saved connections', () => {
    publish([])
    const view = render(<ConnectionsToolWindow />)
    expect(screen.getByText(/^This workspace has no saved connections\. Use \+ to add/)).toBeTruthy()
    act(() => useWorkspaceStore.setState({ scope: 'all' }))
    view.rerender(<ConnectionsToolWindow />)
    expect(screen.getByText(/^No workspace has saved connections\./)).toBeTruthy()
  })

  it('shows the scope in the header and refreshes', () => {
    render(<ConnectionsHeaderActions />)
    expect(screen.getByTestId('connections-refresh-button').hasAttribute('disabled')).toBe(true)
    const { onRefresh } = publish()
    expect(screen.getByTestId('connections-workspace-label').textContent).toBe('Work')
    fireEvent.click(screen.getByTestId('connections-refresh-button'))
    expect(onRefresh).toHaveBeenCalled()
    act(() => useWorkspaceStore.setState({ scope: 'all' }))
    expect(screen.getByTestId('connections-workspace-label').textContent).toBe('All workspaces')
  })

  it('leaves the detail of a host-only connection and an empty local one plain', () => {
    expect(nodeDetail({ kind: 'connection', key: 'k', connection: conn({ host: 'bare' }) })).toBe('bare')
    expect(nodeDetail({ kind: 'connection', key: 'k', connection: conn({ type: 'LOCAL' }) })).toBeUndefined()
    expect(nodeDetail({ kind: 'group', key: 'g', type: 'SSH', children: [] })).toBeUndefined()
  })
})

describe('publishing the connections', () => {
  const api = { list: vi.fn(), loadConnections: vi.fn() }

  beforeEach(() => {
    Object.assign(window, { omnitermAPI: { workspace: api } })
    api.list.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
    api.loadConnections.mockImplementation(async (id: string) => [conn({ id: `${id}-c`, workspaceId: undefined })])
  })

  it('loads every workspace connection tagged with its workspace', async () => {
    await expect(loadSavedConnections()).resolves.toEqual([
      conn({ id: 'w1-c', workspaceId: 'w1' }),
      conn({ id: 'w2-c', workspaceId: 'w2' }),
    ])
  })

  it('publishes the list and connect path, refreshes into the shell, and unpublishes on unmount', async () => {
    const onConnect = vi.fn()
    const setConnections = vi.fn()
    const hook = renderHook(() => usePublishConnections(CONNECTIONS, onConnect, setConnections))
    const panel = useShellPanels.getState().connections!
    expect(panel.connections).toBe(CONNECTIONS)
    panel.onConnect(CONNECTIONS[0]!)
    expect(onConnect).toHaveBeenCalledWith(CONNECTIONS[0])
    await act(() => panel.onRefresh())
    await waitFor(() => expect(setConnections).toHaveBeenCalledWith([
      conn({ id: 'w1-c', workspaceId: 'w1' }),
      conn({ id: 'w2-c', workspaceId: 'w2' }),
    ]))
    const error = vi.spyOn(diag, 'error').mockImplementation(() => undefined)
    api.list.mockRejectedValueOnce(new Error('offline'))
    await act(() => panel.onRefresh())
    expect(error).toHaveBeenCalled()
    hook.unmount()
    expect(useShellPanels.getState().connections).toBeNull()
  })
})
