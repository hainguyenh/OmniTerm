/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../../domain'

import { invalidateProjectIndex } from '../../../utils/projectIndexer'
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
    // The index is cached per workspace for a minute; every test starts from a fresh scan.
    for (const id of ['ws-1', 'ws-2']) invalidateProjectIndex(id)
    localStorage.clear()
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

  it('searches every workspace on request and names the workspace of each result', async () => {
    localStorage.clear()
    const other: Workspace = { id: 'ws-2', name: 'Other', folders: [{ id: 'folder-9', name: 'lib', path: '/other/lib' }], order: 1, pins: [] }
    const scanScripts = vi.fn(async (id: string) => (id === 'ws-2' ? [{ id: 'script-2', name: 'deploy.sh', path: 'scripts/deploy.sh', kind: 'sh' }] : []))
    mockOmnitermAPI({
      workspace: {
        scanScripts,
        scanFolders: vi.fn().mockResolvedValue([]),
        scanFolderEntries: vi.fn().mockResolvedValue({ entries: [], total: 0, hasMore: false }),
      },
    })
    render(
      <ProjectSearchModal isOpen={true} onClose={onClose} workspaces={[dummyWorkspace, other]} activeWorkspaceId="ws-1" onOpenScript={onOpenScript} />,
    )
    await waitFor(() => expect(scanScripts).toHaveBeenCalledWith('ws-1'))
    expect(scanScripts).not.toHaveBeenCalledWith('ws-2')
    fireEvent.click(screen.getByRole('button', { name: 'All workspaces' }))
    expect(await screen.findByText('deploy.sh')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
    fireEvent.click(screen.getByText('deploy.sh'))
    expect(onOpenScript).toHaveBeenCalledWith('ws-2', expect.objectContaining({ name: 'deploy.sh' }))
    expect(localStorage.getItem('omniterm.projectSearch.scope')).toBe('all')
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
