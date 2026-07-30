/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FileBrowser from '../FileBrowser'
import { mockOmnitermAPI } from '../../testUtils'

const entries = [
  { name: 'folder', size: 0, mtime: 1_700_000_000_000, isDir: true, isSymlink: false },
  { name: 'link', size: 0, mtime: 0, isDir: true, isSymlink: true },
  { name: 'tiny.txt', size: 10, mtime: 1_700_000_000_000, isDir: false, isSymlink: false },
  { name: 'medium.bin', size: 1536, mtime: 1_700_000_000_000, isDir: false, isSymlink: false },
  { name: 'large.bin', size: 20 * 1024 * 1024, mtime: 1_700_000_000_000, isDir: false, isSymlink: false },
  { name: '.hidden', size: 2, mtime: 0, isDir: false, isSymlink: false },
]

function setup(overrides: Record<string, unknown> = {}, active = true) {
  const cleanup = vi.fn()
  const api = {
    home: vi.fn().mockResolvedValue('/home/me'),
    list: vi.fn().mockResolvedValue(entries),
    realpath: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rmdirRecursive: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(true),
    upload: vi.fn().mockResolvedValue(1),
    onProgress: vi.fn().mockReturnValue(cleanup),
    ...overrides,
  }
  mockOmnitermAPI({ sftp: api })
  const view = render(<FileBrowser id="session" connectionName="Prod" active={active} />)
  return { ...view, api, cleanup }
}

async function ready() {
  await screen.findByText('tiny.txt')
}

function context(name: string) {
  fireEvent.contextMenu(screen.getByText(name), { clientX: 20, clientY: 40 })
}

describe('FileBrowser complete behavior', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads home, formats sizes and dates, filters hidden files, and unsubscribes progress', async () => {
    const { api, cleanup, unmount, container } = setup()
    await ready()
    expect(api.home).toHaveBeenCalledWith('session')
    expect(api.list).toHaveBeenCalledWith('session', '/home/me')
    expect(screen.getByText('10 B')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('20 MB')).toBeInTheDocument()
    expect(screen.queryByText('.hidden')).not.toBeInTheDocument()
    expect(container.querySelector('[title^="tiny.txt — 10 B"]')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Show hidden files'))
    expect(screen.getByText('.hidden')).toBeInTheDocument()
    expect(screen.getByTitle('Hide hidden files')).toBeInTheDocument()
    unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('does not subscribe while inactive and subscribes when activated', async () => {
    const { api, rerender } = setup({}, false)
    await ready()
    expect(api.onProgress).not.toHaveBeenCalled()
    rerender(<FileBrowser id="session" connectionName="Prod" active />)
    expect(api.onProgress).toHaveBeenCalledWith('session', expect.any(Function))
  })

  it('ignores a late home result after unmount', async () => {
    let resolve!: (path: string) => void
    const home = vi.fn(() => new Promise<string>(ok => { resolve = ok }))
    const { api, unmount } = setup({ home })
    unmount()
    await act(async () => resolve('/late'))
    expect(api.list).not.toHaveBeenCalled()
  })

  it('cleans wrapped errors and reverts a failed typed path to the last good cwd', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(entries)
      .mockRejectedValueOnce(new Error("Error invoking remote method 'sftp:list': Error: denied"))
    const { container } = setup({ list })
    await ready()
    const path = screen.getByTitle('Remote path — press Enter to navigate') as HTMLInputElement
    fireEvent.change(path, { target: { value: '/root' } })
    fireEvent.keyDown(path, { key: 'Enter' })
    await screen.findByText('denied')
    expect(path.value).toBe('/home/me')
    const dismiss = container.querySelector('.text-theme-error button') as HTMLButtonElement
    fireEvent.click(dismiss)
    expect(screen.queryByText('denied')).not.toBeInTheDocument()
  })

  it('uses root for an empty path and Escape restores the current path', async () => {
    const { api } = setup()
    await ready()
    const path = screen.getByTitle('Remote path — press Enter to navigate') as HTMLInputElement
    fireEvent.change(path, { target: { value: '   ' } })
    fireEvent.keyDown(path, { key: 'Enter' })
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('session', '/'))
    fireEvent.change(path, { target: { value: '/bad' } })
    fireEvent.keyDown(path, { key: 'Escape' })
    expect(path.value).toBe('/')
  })

  it('navigates home, parent, folder, and refresh paths', async () => {
    const { api } = setup()
    await ready()
    api.home.mockResolvedValueOnce('/other')
    fireEvent.click(screen.getByTitle('Home directory'))
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('session', '/other'))

    fireEvent.doubleClick(screen.getByText('folder'))
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('session', '/other/folder'))
    fireEvent.click(screen.getByTitle('Up one level'))
    await waitFor(() => expect(api.list).toHaveBeenCalledWith('session', '/other'))
    fireEvent.click(screen.getByTitle('Refresh'))
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('session', '/other'))
  })

  it('reports a home-button failure without changing location', async () => {
    const { api } = setup()
    await ready()
    api.home.mockRejectedValueOnce('home failed')
    fireEvent.click(screen.getByTitle('Home directory'))
    await screen.findByText('home failed')
  })

  it('creates valid folders and cancels empty, slash, Escape, and blur inputs', async () => {
    const { api } = setup()
    await ready()
    const open = () => fireEvent.click(screen.getByTitle('New folder'))

    open()
    let input = screen.getByPlaceholderText('folder name')
    fireEvent.change(input, { target: { value: 'logs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.mkdir).toHaveBeenCalledWith('session', '/home/me/logs'))
    expect(api.list).toHaveBeenCalledTimes(2)

    open(); input = screen.getByPlaceholderText('folder name')
    fireEvent.keyDown(input, { key: 'Enter' })
    open(); input = screen.getByPlaceholderText('folder name')
    fireEvent.change(input, { target: { value: 'bad/name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    open(); input = screen.getByPlaceholderText('folder name')
    fireEvent.keyDown(input, { key: 'Escape' })
    open(); input = screen.getByPlaceholderText('folder name')
    fireEvent.blur(input)
    expect(api.mkdir).toHaveBeenCalledTimes(1)
  })

  it('uploads and downloads without a refresh and displays operation failures', async () => {
    const { api } = setup()
    await ready()
    const initialLists = api.list.mock.calls.length
    fireEvent.click(screen.getByTitle('Upload file(s) here'))
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith('session', '/home/me'))
    expect(api.list.mock.calls.length).toBe(initialLists + 1)

    fireEvent.doubleClick(screen.getByText('tiny.txt'))
    await waitFor(() => expect(api.download).toHaveBeenCalledWith('session', '/home/me/tiny.txt', 'tiny.txt'))
    expect(api.list.mock.calls.length).toBe(initialLists + 1)

    api.download.mockRejectedValueOnce(new Error('download failed'))
    context('tiny.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await screen.findByText('download failed')
  })

  it('renames valid names and cancels unchanged, empty, slash, Escape, blur, and row clicks', async () => {
    const { api } = setup()
    await ready()
    context('tiny.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByDisplayValue('tiny.txt')
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: 'renamed.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith(
      'session', '/home/me/tiny.txt', '/home/me/renamed.txt',
    ))

    const cancel = (value: string, event: 'enter' | 'escape' | 'blur') => {
      context('tiny.txt')
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
      const field = screen.getByDisplayValue('tiny.txt')
      fireEvent.change(field, { target: { value } })
      if (event === 'blur') fireEvent.blur(field)
      else fireEvent.keyDown(field, { key: event === 'escape' ? 'Escape' : 'Enter' })
    }
    cancel('tiny.txt', 'enter')
    cancel('', 'enter')
    cancel('bad/name', 'enter')
    cancel('other', 'escape')
    cancel('other', 'blur')
    expect(api.rename).toHaveBeenCalledTimes(1)
  })

  it('deletes files, symlinks, and recursive folders, with cancel support', async () => {
    const { api } = setup()
    await ready()

    context('tiny.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/tiny.txt.*permanently deleted/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.delete).not.toHaveBeenCalled()

    context('tiny.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('session', '/home/me/tiny.txt'))

    context('link')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('session', '/home/me/link'))

    context('folder')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/ALL of its contents/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.rmdirRecursive).toHaveBeenCalledWith('session', '/home/me/folder'))
  })

  it('closes the context menu by Escape and outside clicks but keeps inside clicks', async () => {
    setup()
    await ready()
    context('tiny.txt')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()

    context('tiny.txt')
    const menu = screen.getByRole('button', { name: 'Download' }).parentElement as HTMLElement
    fireEvent.mouseDown(menu)
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
  })

  it('renders empty directories and both progress display modes, including clearing progress', async () => {
    let progress!: (value: any) => void
    setup({
      list: vi.fn().mockResolvedValue([]),
      onProgress: vi.fn((_id: string, cb: (value: any) => void) => { progress = cb; return vi.fn() }),
    })
    await screen.findByText('Empty directory')

    act(() => progress({ kind: 'upload', name: 'stream.bin', transferred: 2048, total: 0 }))
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    act(() => progress({ kind: 'download', name: 'archive.zip', transferred: 25, total: 100 }))
    expect(screen.getByText('25%')).toBeInTheDocument()
    const bar = screen.getByText('25%').closest('div')?.nextElementSibling?.firstElementChild as HTMLElement
    expect(bar.style.width).toBe('25%')
    act(() => progress(null))
    expect(screen.queryByText('archive.zip')).not.toBeInTheDocument()
  })
})
