/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Connection, Workspace } from '../../../domain'
import type { MenuItem } from '../../../ide/ui'
import { useWorkspaceStore } from '../../../platform/workspaceStore'
import { encodeWorkspaceSelection } from '../../../utils/workspaceSelection'

const menus = vi.hoisted(() => ({ last: [] as unknown[] }))
vi.mock('../../../ide/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showContextMenu: (_at: unknown, items: unknown[]) => {
    menus.last = items
  },
}))
const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../../ide/workbench/messages', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirm,
  showError: vi.fn(async () => undefined),
}))
const showSessionTab = vi.hoisted(() => vi.fn())
vi.mock('../../sessions/sessionTabActions', () => ({ showSessionTab }))

import { useShellPanels } from '../../shellPanelsStore'
import { closeConnectionForm } from '../connectionFormStore'
import { ConnectionsHeaderActions, ConnectionsToolWindow } from '../ConnectionsToolWindow'

const WORKSPACES = [{ id: 'w1', name: 'Work', folders: [] }] as unknown as Workspace[]
const SAVED: Connection = { id: 'web', name: 'web-01', type: 'SSH', host: 'web.example', port: '', user: 'deploy', workspaceId: 'w1' }
const LOCAL: Connection = { id: 'wsl', name: 'Ubuntu', type: 'LOCAL', host: '', port: '', user: '', workspaceId: 'w1' }

const api = {
  saveConnection: vi.fn(async (_id: string, connection: Connection) => connection),
  deleteConnection: vi.fn(async () => true),
  localSshSessions: vi.fn(async (): Promise<LocalSshSession[]> => []),
}

function publish(connections: Connection[] = [SAVED, LOCAL]) {
  const onConnect = vi.fn()
  const onRefresh = vi.fn(async () => undefined)
  act(() => useShellPanels.setState({ connections: { connections, onConnect, onRefresh } }))
  return { onConnect, onRefresh }
}

const row = (name: string) => screen.getAllByRole('treeitem').find((item) => item.textContent?.startsWith(name))!
const item = (label: string) => (menus.last as MenuItem[]).find((entry) => 'label' in entry && entry.label === label) as { run: () => void }

describe('editing connections', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    Object.assign(window, {
      omnitermAPI: {
        workspace: { saveConnection: api.saveConnection, deleteConnection: api.deleteConnection },
        connections: { localSshSessions: api.localSshSessions },
      },
    })
    act(() => useWorkspaceStore.setState({ workspaces: WORKSPACES, selection: encodeWorkspaceSelection('w1'), scope: 'workspace' }))
  })
  afterEach(() => {
    cleanup()
    act(() => closeConnectionForm())
    vi.restoreAllMocks()
    api.saveConnection.mockClear()
    api.deleteConnection.mockClear()
    api.localSshSessions.mockReset().mockResolvedValue([])
    confirm.mockClear()
    showSessionTab.mockClear()
  })

  it('adds an SSH connection from the + menu into the workspace in scope', async () => {
    const { onRefresh } = publish()
    render(<><ConnectionsHeaderActions /><ConnectionsToolWindow /></>)
    fireEvent.click(screen.getByTestId('connections-new-button'))
    act(() => item('New SSH Connection…').run())
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: '10.0.0.5' } })
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'root' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveConnection).toHaveBeenCalledWith('w1', { id: '', type: 'SSH', name: '', host: '10.0.0.5', port: '', user: 'root' }))
    await waitFor(() => expect(screen.queryByTestId('connection-form')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('keeps the form open and saves nothing while the host is missing', () => {
    publish()
    render(<><ConnectionsHeaderActions /><ConnectionsToolWindow /></>)
    fireEvent.click(screen.getByTestId('connections-new-button'))
    act(() => item('New Remote Desktop Connection…').run())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter the host to connect to.')
    expect(api.saveConnection).not.toHaveBeenCalled()
  })

  it('connects, edits and deletes a saved profile from its menu; a local one only connects', async () => {
    const { onConnect } = publish()
    render(<ConnectionsToolWindow />)
    fireEvent.contextMenu(row('web-01'))
    expect((menus.last as MenuItem[]).map((entry) => ('label' in entry ? entry.label : '—'))).toEqual(['Connect', '—', 'Edit…', 'Delete'])
    act(() => item('Connect').run())
    expect(onConnect).toHaveBeenCalledWith(SAVED)

    act(() => item('Edit…').run())
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('web.example')
    act(() => closeConnectionForm())

    fireEvent.contextMenu(row('web-01'))
    act(() => item('Delete').run())
    await waitFor(() => expect(api.deleteConnection).toHaveBeenCalledWith('w1', 'web'))
    expect(confirm).toHaveBeenCalled()

    fireEvent.contextMenu(row('Ubuntu'))
    expect((menus.last as MenuItem[]).map((entry) => ('label' in entry ? entry.label : '—'))).toEqual(['Connect'])
  })

  it('connects, edits and deletes a saved profile from the buttons of its row; a local one only connects', async () => {
    // Regression: the rows had no buttons, so a connection could be used only from its right-click menu.
    const { onConnect } = publish()
    render(<ConnectionsToolWindow />)
    const buttons = (name: string) => within(row(name)).queryAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(buttons('web-01')).toEqual(['Connect', 'Edit…', 'Delete'])
    expect(buttons('Ubuntu')).toEqual(['Connect'])
    expect(buttons('SSH')).toEqual([])

    fireEvent.click(within(row('web-01')).getByRole('button', { name: 'Connect' }))
    expect(onConnect).toHaveBeenCalledWith(SAVED)
    // A quick second click on a button does not connect a second time through the row.
    fireEvent.doubleClick(within(row('web-01')).getByRole('button', { name: 'Connect' }))
    expect(onConnect).toHaveBeenCalledTimes(1)

    fireEvent.click(within(row('web-01')).getByRole('button', { name: 'Edit…' }))
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('web.example')
    act(() => closeConnectionForm())

    fireEvent.click(within(row('web-01')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteConnection).toHaveBeenCalledWith('w1', 'web'))
    expect(confirm).toHaveBeenCalled()
  })

  it('lists an ssh typed in a terminal, shows its terminal and saves it as a connection', async () => {
    api.localSshSessions.mockResolvedValue([{ sessionId: 's1', pid: 9, user: 'root', host: 'box.test', port: '2222' }])
    publish([])
    render(<ConnectionsToolWindow />)
    await waitFor(() => expect(screen.getAllByRole('treeitem')[0]?.textContent).toBe('Active SSH (not saved)1'))
    fireEvent.doubleClick(row('root@box.test:2222'))
    expect(showSessionTab).toHaveBeenCalledWith('s1')
    fireEvent.contextMenu(row('root@box.test:2222'))
    act(() => item('Save as Connection…').run())
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('2222')
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('root@box.test')
  })
})
