/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../testUtils'
import WorkspacePanel from '../WorkspacePanel'
import { WS, dir, file, page } from './workspacePanelTestUtils'

const API_WS = { ...WS, folders: [{ id: 'folder#1', name: 'api', path: 'C:/proj' }] }
const README = { ...file('folder#1/readme.txt', 'txt'), viewable: true }

function mockTree(overrides: Record<string, unknown> = {}) {
  const list = vi.fn(async () => [API_WS])
  const scanFolders = vi.fn(async () => [dir('folder#1'), dir('folder#1/docs')])
  const scanFolderEntries = vi.fn(async (_id: string, folder: string) =>
    page(folder === 'folder#1' ? [README] : []))
  mockOmnitermAPI({ workspace: { list, scanFolders, scanFolderEntries, ...overrides } })
  return { list, scanFolders }
}

async function openWorkspace(props: Partial<Parameters<typeof WorkspacePanel>[0]> = {}) {
  render(<WorkspacePanel onOpenScript={vi.fn()} {...props} />)
  fireEvent.click(await screen.findByText('my-project'))
  await screen.findByText('readme.txt')
}

const chooseAction = (row: string, action: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${row}` }))
  fireEvent.click(screen.getByRole('menuitem', { name: action }))
}

describe('WorkspacePanel file and folder edits', () => {
  beforeEach(() => localStorage.clear())

  it('creates a subfolder from the folder menu and rescans the workspace', async () => {
    const createDirectory = vi.fn()
      .mockRejectedValueOnce(new Error('A file or folder with this name already exists.'))
      .mockResolvedValueOnce('folder#1/notes')
    const { scanFolders } = mockTree({ createDirectory })
    await openWorkspace()

    chooseAction('api', 'New folder…')
    const dialog = screen.getByRole('dialog', { name: 'Create New Folder' })
    expect(dialog).toHaveTextContent('In folder: api')
    const input = within(dialog).getByLabelText('Folder name')
    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('cannot contain slashes')
    expect(createDirectory).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: ' notes ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createDirectory).toHaveBeenLastCalledWith('ws#1', 'folder#1/notes')
    await waitFor(() => expect(scanFolders).toHaveBeenCalledTimes(2))
  })

  it('renames a file inline, then reloads workspaces so a moved pin follows', async () => {
    const moveFile = vi.fn(async () => 'folder#1/notes.txt')
    const { list, scanFolders } = mockTree({ moveFile })
    await openWorkspace()

    chooseAction('readme.txt', 'Rename file')
    const input = screen.getByRole('textbox', { name: 'File name' })
    fireEvent.change(input, { target: { value: 'notes.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(moveFile).toHaveBeenCalledWith('ws#1', 'folder#1/readme.txt', 'folder#1/notes.txt'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scanFolders).toHaveBeenCalledTimes(2))
  })

  it('reports a failed rename instead of leaving it silent', async () => {
    const showAlert = vi.fn()
    mockTree({ moveFile: vi.fn(async () => { throw new Error('A file or folder with this name already exists.') }) })
    await openWorkspace({ showAlert })

    chooseAction('readme.txt', 'Rename file')
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'docs' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'File name' }), { key: 'Enter' })

    await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
      'A file or folder with this name already exists.',
      { title: 'Could not rename file', tone: 'error' },
    ))
  })

  it('moves a file into a folder chosen in the move dialog', async () => {
    const moveFile = vi.fn(async () => 'folder#1/docs/readme.txt')
    mockTree({ moveFile })
    await openWorkspace()

    chooseAction('readme.txt', 'Move file to…')
    const dialog = screen.getByRole('dialog', { name: 'Move File' })
    expect(within(dialog).getByRole('radio', { name: /^api\s*\(current\)$/ })).toBeDisabled()
    const move = within(dialog).getByRole('button', { name: 'Move' })
    expect(move).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Filter folders'), { target: { value: 'nothing' } })
    expect(dialog).toHaveTextContent('No folder matches the filter.')
    fireEvent.change(within(dialog).getByLabelText('Filter folders'), { target: { value: 'DOCS' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'api/docs' }))
    fireEvent.click(move)

    await waitFor(() => expect(moveFile).toHaveBeenCalledWith('ws#1', 'folder#1/readme.txt', 'folder#1/docs/readme.txt'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the move dialog open with the reason when a move fails', async () => {
    mockTree({ moveFile: vi.fn(async () => { throw new Error('Could not move the file: in use') }) })
    await openWorkspace()

    chooseAction('readme.txt', 'Move file to…')
    const dialog = screen.getByRole('dialog', { name: 'Move File' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'api/docs' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not move the file: in use')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes a file only after confirmation', async () => {
    const deleteFile = vi.fn(async () => {})
    mockTree({ deleteFile })
    await openWorkspace()

    chooseAction('readme.txt', 'Delete file')
    expect(screen.getByRole('dialog')).toHaveTextContent('Permanently delete "readme.txt" from disk? This cannot be undone.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleteFile).not.toHaveBeenCalled()

    chooseAction('readme.txt', 'Delete file')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith('ws#1', 'folder#1/readme.txt'))
  })

  it('marks the file behind the active editor tab', async () => {
    mockTree()
    await openWorkspace({ activeFile: { workspaceId: 'ws#1', path: 'folder#1/readme.txt' } })
    expect(screen.getByRole('button', { name: 'readme.txt' })).toHaveAttribute('aria-current', 'true')
  })
})
