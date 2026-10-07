/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@omniterm/contract'

import { ProjectSearchModal } from '../ProjectSearchModal'
import { mockOmnitermAPI } from '../../../testUtils'

const dummyWorkspace: Workspace = {
  id: 'ws-1',
  name: 'Test Project',
  folders: [{ id: 'folder-1', name: 'src', path: '/repo/src' }],
  order: 0,
  pins: [],
}

describe('ProjectSearchModal', () => {
  const onOpenScript = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockOmnitermAPI({
      workspace: {
        scanScripts: vi.fn().mockResolvedValue([
          { id: 'script-1', name: 'build.sh', path: 'scripts/build.sh', kind: 'sh' },
        ]),
        scanFolders: vi.fn().mockResolvedValue([
          { id: 'folder-1', name: 'src', path: 'src', isDir: true, kind: 'dir' },
        ]),
        scanFolderEntries: vi.fn().mockResolvedValue({
          entries: [
            { id: 'file-1', name: 'index.ts', path: 'src/index.ts', isDir: false, kind: 'ts' },
            { id: 'file-2', name: 'app.tsx', path: 'src/app.tsx', isDir: false, kind: 'tsx' },
          ],
          total: 2,
          hasMore: false,
        }),
      },
    })
  })

  it('does not render when isOpen is false', () => {
    render(
      <ProjectSearchModal
        isOpen={false}
        onClose={onClose}
        workspaces={[dummyWorkspace]}
        onOpenScript={onOpenScript}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders and displays loaded project files', async () => {
    render(
      <ProjectSearchModal
        isOpen={true}
        onClose={onClose}
        workspaces={[dummyWorkspace]}
        onOpenScript={onOpenScript}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search Everywhere/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
    expect(screen.getByText('build.sh')).toBeInTheDocument()
    expect(screen.getByText('app.tsx')).toBeInTheDocument()
  })

  it('filters files based on query input', async () => {
    render(
      <ProjectSearchModal
        isOpen={true}
        onClose={onClose}
        workspaces={[dummyWorkspace]}
        onOpenScript={onOpenScript}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Search Everywhere/i)
    fireEvent.change(input, { target: { value: 'app' } })

    expect(screen.getByText('app.tsx')).toBeInTheDocument()
    expect(screen.queryByText('index.ts')).toBeNull()
  })

  it('opens selected file on Enter and closes modal', async () => {
    render(
      <ProjectSearchModal
        isOpen={true}
        onClose={onClose}
        workspaces={[dummyWorkspace]}
        onOpenScript={onOpenScript}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Search Everywhere/i)
    fireEvent.change(input, { target: { value: 'build' } })

    expect(screen.getByText('build.sh')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenScript).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      name: 'build.sh',
      path: 'scripts/build.sh',
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates with ArrowDown and closes with Escape', async () => {
    render(
      <ProjectSearchModal
        isOpen={true}
        onClose={onClose}
        workspaces={[dummyWorkspace]}
        onOpenScript={onOpenScript}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
