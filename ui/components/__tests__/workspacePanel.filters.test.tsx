/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import WorkspacePanel from '../WorkspacePanel'
import { BAT, RDP, WS, dir, file, mockScan, page } from './workspacePanelTestUtils'

describe('WorkspacePanel filters and connections', () => {
  beforeEach(() => localStorage.clear())

  /** The scan reports dot-files now; only "All files" shows them. */
  it('keeps hidden files out of the default view and shows them under "All files"', async () => {
    mockScan([dir('.vscode')], [BAT, file('.env', 'env'), file('.vscode/settings.json', 'json')])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')
    expect(screen.queryByText('.env')).not.toBeInTheDocument()
    expect(screen.queryByText('.vscode')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('All files'))
    expect(screen.getByText('.env')).toBeInTheDocument()
    // The hidden folder is part of the tree once "All files" admits it.
    expect(screen.getByText('.vscode')).toBeInTheDocument()
  })

  /** One tick on a folder has to speak for everything under it, or the tree is unusable. */
  it('ticks a whole subtree from its folder, and reports the partial state', async () => {
    mockScan([dir('tools')], [file('tools/go.sh', 'sh', 'wsl'), file('tools/notes.txt', 'txt')])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('tools')
    fireEvent.click(screen.getByText('tools'))
    await screen.findByText('go.sh')

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('Selected files'))
    const menu = screen.getByRole('group', { name: 'Workspace filter' })

    // Seeded with the scripts present, so the folder holds one of its two files.
    const folder = within(menu).getByLabelText('tools') as HTMLInputElement
    expect(folder.checked).toBe(false)
    expect(folder.indeterminate).toBe(true)

    // Ticking the folder takes everything under it; ticking again lets it all go.
    fireEvent.click(folder)
    expect((within(menu).getByLabelText('tools') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('2 files')).toBeInTheDocument()

    fireEvent.click(within(menu).getByLabelText('tools'))
    expect(screen.getByText('0 files')).toBeInTheDocument()
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) })
  })

  /** A type covers files added after the pick, which is what a path selection cannot do. */
  it('filters by type, and names a single chosen type in the option row', async () => {
    mockScan([], [BAT, RDP, file('notes.txt', 'txt')])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('Selected types'))
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    // Seeded with the runnable kinds present, so .txt is offered but not ticked.
    expect((within(menu).getByLabelText('.txt') as HTMLInputElement).checked).toBe(false)
    expect((within(menu).getByLabelText('.bat') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(within(menu).getByLabelText('.rdp'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('deploy.bat')).toBeInTheDocument()
    expect(screen.queryByText('server.rdp')).not.toBeInTheDocument()
    expect(screen.getByText('.bat')).toBeInTheDocument()
  })

  /** The dialog overlaps the tree it filters, so it has to be movable off it. */
  it('lets the filter dialog be dragged by its title bar', async () => {
    mockScan([], [BAT])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    const before = menu.style.left

    fireEvent.mouseDown(screen.getByText('FILTER Workspace'), { clientX: 100, clientY: 100, button: 0 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(window)

    expect(menu.style.left).toBe('300px')
    expect(menu.style.left).not.toBe(before)
    expect(menu.style.top).toBe('200px')
  })

  it('keeps each workspace on its own filter', async () => {
    const WS2 = { id: 'ws#2', name: 'other-project', folders: [{ id: 'folder#2', name: 'other-project', path: 'C:/other' }], order: 1, pins: [] }
    mockOmnitermAPI({
      workspace: {
        list: async () => [WS, WS2],
        scanFolders: async () => [],
        scanFolderEntries: async () => page([BAT, file('notes.txt', 'txt')]),
        run: async () => true,
      },
    })
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')
    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('All files'))
    // Closed first: the open menu's own radio label reads "All files" too.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('All files')).toBeInTheDocument()

    // A path-based selection is workspace-scoped, so the second workspace starts from the default.
    fireEvent.click(screen.getByText('other-project'))
    await waitFor(() => expect(screen.getByText('Scripts')).toBeInTheDocument())
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
  })

  it('searches folders, files and connections at once', async () => {
    const CONN = { id: 'c1', name: 'Staging RDP', type: 'RDP' as const, host: '1.2.3.4', port: '3389', user: 'admin' }
    mockOmnitermAPI({
      workspace: {
        list: async () => [WS],
        scanFolders: async () => [dir('tools')],
        scanFolderEntries: async (_id: string, folder: string) =>
          page(folder === 'tools' ? [file('tools/go.sh', 'sh', 'wsl')] : [BAT]),
        loadConnections: async () => [CONN],
        run: async () => true,
      },
    })
    render(<WorkspacePanel hasConnectionProvider onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')
    // The file lives in a collapsed folder, so open it before searching it.
    fireEvent.click(screen.getByText('tools'))
    await screen.findByText('go.sh')

    // Search is one icon on the header line until it is asked for; opening it swaps in the input.
    fireEvent.click(screen.getByLabelText('Search workspace'))
    fireEvent.change(screen.getByLabelText('Search workspace'), { target: { value: 'go.sh' } })
    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.getByText('go.sh')).toBeInTheDocument()
    expect(screen.queryByText('deploy.bat')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search workspace'), { target: { value: 'admin@1.2.3.4' } })
    expect(screen.getByText('Staging RDP')).toBeInTheDocument()
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()
  })

  // ── Connections live in the tree ───────────────────────────────────────────

  it('loads connections and nests each one under the folder in its parentId', async () => {
    const ROOT_CONN = { id: 'c1', name: 'Staging RDP', type: 'RDP' as const, host: '1.2.3.4', port: '3389', user: 'admin' }
    const NESTED_CONN = { id: 'c2', name: 'prod-web', type: 'SSH' as const, host: 'web1', port: '22', user: 'ops', parentId: 'infra' }
    const loadConnections = vi.fn(async () => [ROOT_CONN, NESTED_CONN])
    const onConnect = vi.fn()
    mockOmnitermAPI({
      workspace: { list: async () => [WS], scanFolders: async () => [dir('infra')], scanFolderEntries: async () => page([]), loadConnections, run: async () => true },
    })

    render(<WorkspacePanel hasConnectionProvider onOpenScript={vi.fn()} onConnectWorkspaceConnection={onConnect} />)
    fireEvent.click(await screen.findByText('my-project'))
    await waitFor(() => expect(screen.getByText('Staging RDP')).toBeInTheDocument())
    expect(loadConnections).toHaveBeenCalledWith('ws#1')

    // The nested one renders inside the 'infra' folder, not as a sibling of it — once expanded.
    expect(screen.queryByText('prod-web')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('infra'))
    const infraRow = screen.getByText('infra').parentElement as HTMLElement
    const infraBlock = infraRow.parentElement as HTMLElement
    expect(within(infraBlock).getByText('prod-web')).toBeInTheDocument()

    fireEvent.click(within(screen.getByText('Staging RDP').parentElement as HTMLElement).getByTitle('Connect'))
    expect(onConnect).toHaveBeenCalledWith(ROOT_CONN, WS.id)
  })

  it('adds a connection in the folder whose Cable button was clicked', async () => {
    const onAdd = vi.fn()
    mockScan([dir('tools')], [file('tools/deploy.ps1', 'ps1', 'powershell')])
    render(<WorkspacePanel hasConnectionProvider onOpenScript={vi.fn()} onAddWorkspaceConnection={onAdd} />)
    fireEvent.click(await screen.findByText('my-project'))

    fireEvent.click(await screen.findByLabelText('Add connection in tools'))
    expect(onAdd).toHaveBeenCalledWith({
      workspaceId: 'ws#1',
      parentPath: 'tools',
      rootLabel: 'my-project',
      folders: [{ id: 'tools', name: 'tools', parentId: undefined }],
    })

    // The workspace row's own button files the connection at the root instead.
    onAdd.mockClear()
    fireEvent.click(screen.getByLabelText('Add connection in my-project'))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ parentPath: '', rootLabel: 'my-project' })
  })

  it('offers no connection UI without a provider', async () => {
    mockScan([dir('tools')], [file('tools/deploy.ps1', 'ps1', 'powershell')])
    render(<WorkspacePanel onOpenScript={vi.fn()} onAddWorkspaceConnection={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('tools')
    expect(screen.queryByLabelText('Add connection in tools')).not.toBeInTheDocument()
  })
})
