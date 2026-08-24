/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import WorkspacePanel from '../WorkspacePanel'
import { dir } from './workspacePanelTestUtils'

describe('WorkspacePanel folder aliases', () => {
it('renders the folder alias and supports double-click rename', async () => {
  const aliased = { id: 'ws#1', name: 'my-project', folders: [{ id: 'folder#1', name: 'Backend API', path: 'C:/proj/api-gateway' }], order: 0, pins: [] }
  const renameFolder = vi.fn(async () => ({
    ...aliased,
    folders: [{ id: 'folder#1', name: 'BE Frontend', path: 'C:/proj/api-gateway' }],
  }))
  mockOmnitermAPI({
    workspace: {
      list: async () => [aliased],
      scanFolders: async () => [dir('folder#1')],
      renameFolder,
    },
  })
  render(<WorkspacePanel onOpenScript={vi.fn()} />)
  // Expand the workspace first — folder rows only exist inside it.
  await screen.findByText('my-project')
  fireEvent.click(screen.getByText('my-project'))
  // Alias wins over the path basename in the tree row.
  await screen.findByText('Backend API')

  fireEvent.doubleClick(screen.getByText('Backend API'))
  const input = screen.getByLabelText('Folder alias') as HTMLInputElement
  expect(input.value).toBe('Backend API')

  fireEvent.change(input, { target: { value: 'BE Frontend' } })
  fireEvent.blur(input)
  await waitFor(() => expect(renameFolder).toHaveBeenCalledWith('ws#1', 'folder#1', 'BE Frontend'))
  await screen.findByText('BE Frontend')
})
})
