/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import WorkspacePanel from '../WorkspacePanel'
import { BAT, WS, dir, file, filterAs, page } from './workspacePanelTestUtils'

/** Paging: per folder, and only for the whole-tree filters. */
describe('WorkspacePanel paging', () => {
  beforeEach(() => localStorage.clear())

  /** The scripts view promises the whole workspace: everything is loaded, and no "Show more" row
   *  may appear — paging rows exist only for "All files" and "Selected types". */
  it('loads every file in the scripts view, with no "Show more" row', async () => {
    localStorage.setItem('cc.workspaceFilters', JSON.stringify({ 'ws#1': filterAs('scripts') }))
    const scanFolderEntries = vi.fn(async (_id: string, folder: string, offset: number) => {
      if (folder !== '') return page([])
      return offset === 0 ? page([BAT], true, 2) : page([file('more.ps1', 'ps1', 'powershell')])
    })
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
    const scanFolderEntries = vi.fn(async (_id: string, folder: string, offset: number) => {
      if (folder !== '') return page([])
      return offset === 0 ? page([BAT], true, 2) : page([file('notes.txt', 'txt')])
    })
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
    const scanFolderEntries = vi.fn(async (_id: string, folder: string, offset: number) => {
      if (folder === '') return page([BAT])
      if (folder !== 'tools') return page([])
      return offset === 0
        ? page([file('tools/a.txt', 'txt'), file('tools/b.txt', 'txt')], true, 3)
        : page([file('tools/c.txt', 'txt')])
    })
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
