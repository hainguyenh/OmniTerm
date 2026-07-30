/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import WorkspacePanel from '../WorkspacePanel'
import { BAT, RDP, WS, dir, file, filterAs, mockScan, page, scriptOf } from './workspacePanelTestUtils'

describe('WorkspacePanel', () => {
  beforeEach(() => localStorage.clear())

  it('shows the empty state when no workspaces exist', async () => {
    mockOmnitermAPI({ workspace: { list: async () => [] } })
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/No project folders yet/i)).toBeInTheDocument())
  })

  it('scans on expand and runs a script via the run icon', async () => {
    const run = vi.fn(async () => true)
    const scanFolderEntries = vi.fn(async () => page([BAT]))
    mockOmnitermAPI({ workspace: { list: async () => [WS], scanFolders: async () => [], scanFolderEntries, run } })

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())

    fireEvent.click(screen.getByText('my-project'))
    await waitFor(() => expect(screen.getByText('deploy.bat')).toBeInTheDocument())
    // The skeleton and the root folder's first page arrive together on expand.
    expect(scanFolderEntries).toHaveBeenCalledWith('ws#1', '', 0, 2000)

    fireEvent.click(screen.getByTitle('Run'))
    expect(run).toHaveBeenCalledWith({ workspaceId: 'ws#1', script: scriptOf(BAT) })
  })

  /**
   * With a host handler the panel must not run the script itself: the host has to own the launch so it
   * can pair the run's pane with the file's editor when both are open.
   */
  it('hands the run to the host when it supplies a handler', async () => {
    const run = vi.fn(async () => true)
    const onRunScript = vi.fn()
    mockScan([], [BAT])

    render(<WorkspacePanel onOpenScript={vi.fn()} onRunScript={onRunScript} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())
    fireEvent.click(screen.getByText('my-project'))
    await waitFor(() => expect(screen.getByText('deploy.bat')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Run'))
    expect(onRunScript).toHaveBeenCalledWith('ws#1', scriptOf(BAT))
    expect(run).not.toHaveBeenCalled()
  })

  it('clicking a script opens it in the dock (onOpenScript) and does not run it', async () => {
    const run = vi.fn(async () => true)
    const onOpenScript = vi.fn()
    mockScan([], [BAT])

    render(<WorkspacePanel onOpenScript={onOpenScript} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())
    fireEvent.click(screen.getByText('my-project'))
    await waitFor(() => expect(screen.getByText('deploy.bat')).toBeInTheDocument())

    fireEvent.click(screen.getByText('deploy.bat'))
    expect(onOpenScript).toHaveBeenCalledWith('ws#1', scriptOf(BAT))
    expect(run).not.toHaveBeenCalled()
  })

  it('opens a plain terminal (no script) via the row action', async () => {
    const run = vi.fn(async () => true)
    mockScan([], [], run)

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Open terminal here'))
    expect(run).toHaveBeenCalledWith({ workspaceId: 'ws#1' })
  })

  it('opens a terminal rooted in a subfolder via the folder row action (passes subPath)', async () => {
    const run = vi.fn(async () => true)
    mockScan([dir('scripts'), dir('scripts/deploy')], [file('scripts/deploy/go.sh', 'sh', 'wsl')], run)

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())
    fireEvent.click(screen.getByText('my-project'))
    await waitFor(() => expect(screen.getByText('scripts')).toBeInTheDocument())

    // The 'scripts' folder row exposes its own "Open terminal here" action.
    const scriptsRow = screen.getByText('scripts').parentElement as HTMLElement
    fireEvent.click(within(scriptsRow).getByTitle('Open terminal here'))
    expect(run).toHaveBeenCalledWith({ workspaceId: 'ws#1', subPath: 'scripts' })
  })

  /** Folders start collapsed; a folder's files arrive when it is expanded. */
  it('shows every folder up front, and a folder only reveals its files once expanded', async () => {
    mockScan([dir('scripts'), dir('tools')], [file('scripts/go.sh', 'sh', 'wsl'), file('tools/deploy.ps1', 'ps1', 'powershell')])

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))

    // The whole skeleton is visible at once — no file is.
    await waitFor(() => expect(screen.getByText('scripts')).toBeInTheDocument())
    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()
    expect(screen.queryByText('deploy.ps1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('tools'))
    expect(await screen.findByText('deploy.ps1')).toBeInTheDocument()
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()
  })

  /**
   * Regression: in "All files" mode, expanding a folder that turns out to hold nothing (or nothing
   * the filter admits) used to disappear the instant its page landed — pruned as "empty" one frame
   * after the user clicked it open. An explicitly expanded folder must stay visible regardless.
   */
  it('never hides a folder the user just expanded, even once it loads empty', async () => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify({ 'ws#1': filterAs('all') }))
    mockScan([dir('empty'), dir('full')], [file('full/a.txt', 'txt')])

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('empty')

    fireEvent.click(screen.getByText('empty'))
    // The click resolves `loadFolder` and the row must survive the re-render that follows.
    await waitFor(() => expect(screen.getByText('full')).toBeInTheDocument())
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  /**
   * Regression: opening a workspace used to flash the whole folder skeleton (every dir kept while
   * "unloaded"), then shrink to the folders that actually hold scripts once the drain landed. In
   * the views that load every folder, an unloaded folder must not appear at all.
   */
  it('never flashes unloaded folders while the scripts view is draining', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const scanFolderEntries = vi.fn(async (_id: string, folder: string) => {
      if (folder === '') return page([])
      await gate
      if (folder === 'scripts') return page([file('scripts/go.sh', 'bat', 'cmd')])
      return page([])
    })
    mockOmnitermAPI({
      workspace: {
        list: async () => [WS],
        scanFolders: async () => [dir('scripts'), dir('empty')],
        scanFolderEntries,
        run: async () => true,
      },
    })

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))

    // Skeleton arrived but the drain is still in flight: no folder may appear yet — `empty` holds
    // no script and would only flash for a frame, and `scripts` is not loaded either.
    await waitFor(() => expect(scanFolderEntries).toHaveBeenCalledWith('ws#1', 'scripts', 0, 2000))
    expect(screen.queryByText('scripts')).not.toBeInTheDocument()
    expect(screen.queryByText('empty')).not.toBeInTheDocument()

    release()
    // Once the drain lands: the folder with a script appears, the empty one stays hidden.
    await screen.findByText('scripts')
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
  })

  it('collapses and expands every folder via the tree toggle-all action', async () => {
    mockScan([dir('scripts')], [file('scripts/go.sh', 'sh', 'wsl')])

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())
    fireEvent.click(screen.getByText('my-project'))
    await screen.findByText('scripts')

    // Expand all → the folder opens and its file appears; collapse all hides it again.
    fireEvent.click(screen.getByTitle('Expand all'))
    expect(await screen.findByText('go.sh')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Collapse all'))
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Expand all'))
    expect(screen.getByText('go.sh')).toBeInTheDocument()
  })

  it('lets .rdp be opened in the dock too, with a Launch run action', async () => {
    const run = vi.fn(async () => true)
    const onOpenScript = vi.fn()
    mockScan([], [RDP], run)

    render(<WorkspacePanel onOpenScript={onOpenScript} />)
    await waitFor(() => expect(screen.getByText('my-project')).toBeInTheDocument())
    fireEvent.click(screen.getByText('my-project'))
    await waitFor(() => expect(screen.getByText('server.rdp')).toBeInTheDocument())

    // Clicking a .rdp still opens it in the dock (which shows a launch placeholder).
    fireEvent.click(screen.getByText('server.rdp'))
    expect(onOpenScript).toHaveBeenCalledWith('ws#1', scriptOf(RDP))

    // The run icon is labelled "Launch" for .rdp.
    fireEvent.click(screen.getByTitle('Launch'))
    expect(run).toHaveBeenCalledWith({ workspaceId: 'ws#1', script: scriptOf(RDP) })
  })

  // ── The tree itself ────────────────────────────────────────────────────────

  /** A folder with nothing runnable in it is noise by default, but the filter can ask for it. */
  it('hides a folder that holds no scripts until empty folders are asked for', async () => {
    mockScan([dir('empty')], [BAT])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')
    expect(screen.queryByText('empty')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('Show empty folders'))
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('hides non-script files until the filter is opened up to all files', async () => {
    mockScan([], [BAT, file('notes.txt', 'txt')])
    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Filter workspace contents'))
    fireEvent.click(screen.getByLabelText('All files'))
    expect(screen.getByText('notes.txt')).toBeInTheDocument()

    // "Selected files" narrows it the other way: tick the .txt out of the menu's own tree, untick
    // the script that was seeded. Scoped to the menu, which lists the same file names as the panel.
    fireEvent.click(screen.getByLabelText('Selected files'))
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    fireEvent.click(within(menu).getByLabelText('notes.txt'))
    fireEvent.click(within(menu).getByLabelText('deploy.bat'))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.queryByText('deploy.bat')).not.toBeInTheDocument()
    // The option row states what survived instead of leaving it to the funnel's tint.
    expect(screen.getByText('1 file')).toBeInTheDocument()
  })

  // ── Paging: per folder, and only for the whole-tree filters ────────────────

  /** The scripts view promises the whole workspace: everything is loaded, and no "Show more" row
   *  may appear — paging rows exist only for "All files" and "Selected types". */
  it('loads every file in the scripts view, with no "Show more" row', async () => {
    const scanFolderEntries = vi.fn()
      .mockResolvedValueOnce(page([BAT], true, 2))
      .mockResolvedValueOnce(page([file('more.ps1', 'ps1', 'powershell')]))
    mockOmnitermAPI({ workspace: { list: async () => [WS], scanFolders: async () => [], scanFolderEntries, run: async () => true } })

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))

    // The second page is fetched on its own — no click asked for it.
    await waitFor(() => expect(scanFolderEntries).toHaveBeenLastCalledWith('ws#1', '', 1, 2000))
    expect(await screen.findByText('more.ps1')).toBeInTheDocument()
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument()
  })

  /** The old scan silently stopped at 2000 entries; a root-folder "Show more" is how the rest arrive. */
  it('grows the root one page at a time via "Show more" under "All files"', async () => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify({ 'ws#1': filterAs('all') }))
    const scanFolderEntries = vi.fn()
      .mockResolvedValueOnce(page([BAT], true, 2))
      .mockResolvedValueOnce(page([file('notes.txt', 'txt')]))
    mockOmnitermAPI({ workspace: { list: async () => [WS], scanFolders: async () => [], scanFolderEntries, run: async () => true } })

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')

    // hasMore → the row appears at the bottom of the workspace and counts down from the scan's total.
    expect(screen.getByText('Show more (1 remaining)')).toBeInTheDocument()
    expect(scanFolderEntries).toHaveBeenCalledWith('ws#1', '', 0, 2000)

    // The next page is fetched from where the first one ended.
    fireEvent.click(screen.getByText('Show more (1 remaining)'))
    await waitFor(() => expect(scanFolderEntries).toHaveBeenLastCalledWith('ws#1', '', 1, 2000))
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  /** "Show more" lives on the folder that has more files, not on the workspace as a whole. */
  it('pages an expanded folder on its own "Show more" row', async () => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify({ 'ws#1': filterAs('all') }))
    const scanFolderEntries = vi.fn()
      .mockImplementationOnce(async () => page([BAT]))                       // root
      .mockImplementationOnce(async () => page([file('tools/a.txt', 'txt'), file('tools/b.txt', 'txt')], true, 3)) // tools p1
      .mockImplementationOnce(async () => page([file('tools/c.txt', 'txt')])) // tools p2
    mockOmnitermAPI({
      workspace: {
        list: async () => [WS],
        scanFolders: async () => [dir('tools')],
        scanFolderEntries,
        run: async () => true,
      },
    })

    render(<WorkspacePanel onOpenScript={vi.fn()} />)
    fireEvent.click(await screen.findByText('my-project'))
    await screen.findByText('deploy.bat')

    // The folder is collapsed, so no paging row anywhere yet.
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('tools'))
    expect(await screen.findByText('Show more (1 remaining)')).toBeInTheDocument()
    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('b.txt')).toBeInTheDocument()
    expect(screen.queryByText('c.txt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show more (1 remaining)'))
    expect(await screen.findByText('c.txt')).toBeInTheDocument()
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument()
    expect(scanFolderEntries).toHaveBeenCalledWith('ws#1', 'tools', 0, 2000)
    expect(scanFolderEntries).toHaveBeenCalledWith('ws#1', 'tools', 2, 2000)
  })
})
