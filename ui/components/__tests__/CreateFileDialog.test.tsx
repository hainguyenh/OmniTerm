/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateFileDialog } from '../CreateFileDialog'
import { mockOmnitermAPI } from '../../testUtils'

describe('CreateFileDialog', () => {
  beforeEach(() => {
    mockOmnitermAPI()
  })

  it('renders correctly with folder path', () => {
    render(
      <CreateFileDialog
        workspaceId="ws#1"
        folderPath="src/components"
        folderName="components"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByText('Create New File')).toBeInTheDocument()
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('filename')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('txt')).toBeInTheDocument()
  })

  it('validates empty file name and slashes', async () => {
    render(
      <CreateFileDialog
        workspaceId="ws#1"
        folderPath="src"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    )

    const nameInput = screen.getByPlaceholderText('filename')
    const form = nameInput.closest('form')!

    // Typing slashes
    fireEvent.change(nameInput, { target: { value: 'foo/bar' } })
    fireEvent.submit(form)
    expect(await screen.findByText('File name cannot contain slashes')).toBeInTheDocument()
  })

  it('calls createTextFile and onCreated upon submission', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const createMock = vi.fn().mockResolvedValue('folder#1/src/newfile.ts')
    mockOmnitermAPI({
      workspace: {
        createTextFile: createMock,
      },
    })

    render(
      <CreateFileDialog
        workspaceId="ws#1"
        folderPath="folder#1/src"
        onClose={onClose}
        onCreated={onCreated}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('filename'), { target: { value: 'newfile' } })
    fireEvent.change(screen.getByPlaceholderText('txt'), { target: { value: 'ts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith('ws#1', 'folder#1/src/newfile.ts')
      expect(onCreated).toHaveBeenCalledWith('folder#1/src/newfile.ts', 'newfile.ts')
      expect(onClose).toHaveBeenCalled()
    })
  })
})
