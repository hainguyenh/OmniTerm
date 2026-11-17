/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const diagError = vi.fn()
vi.mock('../../../diag', () => ({
  diag: { error: (...args: unknown[]) => diagError(...args), log: vi.fn(), warn: vi.fn() },
}))

import type { Workspace, WorkspaceFolder } from '../../../domain'
import { useWorkspaceStore } from '../../../platform/workspaceStore'
import { useProjectFilterStore } from '../../projectFilterStore'
import {
  addFolderToWorkspace,
  addWorkspaceFromFolder,
  createWorkspace,
  importWorkspaceFile,
  removeFolderFromWorkspace,
  workspaceFolderAt,
} from '../workspaceActions'

const folder: WorkspaceFolder = { id: 'f1', name: 'app', path: 'D:\\Work\\App\\' }
const workspace: Workspace = { id: 'w1', name: 'Work', folders: [folder], order: 0, pins: [] }

const api = {
  add: vi.fn(),
  importFile: vi.fn(),
  create: vi.fn(),
  addFolder: vi.fn(),
  removeFolder: vi.fn(),
}
const refresh = vi.fn(async () => undefined)
const setSelection = vi.fn()

describe('workspace actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.values(api).forEach((fn) => fn.mockReset())
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = { workspace: api }
    useWorkspaceStore.setState({ refresh, setSelection } as never)
    useProjectFilterStore.setState({ filter: 'all' })
  })

  it('adds, imports and creates a workspace, then selects it', async () => {
    api.add.mockResolvedValue(workspace)
    await addWorkspaceFromFolder()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setSelection).toHaveBeenCalledTimes(1)

    api.importFile.mockResolvedValue(workspace)
    await importWorkspaceFile()
    api.create.mockResolvedValue(workspace)
    await createWorkspace('  Work  ')
    expect(api.create).toHaveBeenCalledWith('Work')
    expect(setSelection).toHaveBeenCalledTimes(3)
  })

  it('refreshes without selecting when the picker was cancelled, and ignores a blank name', async () => {
    api.add.mockResolvedValue(null)
    await addWorkspaceFromFolder()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setSelection).not.toHaveBeenCalled()
    await createWorkspace('   ')
    expect(api.create).not.toHaveBeenCalled()
  })

  it('logs a failure instead of throwing', async () => {
    Object.values(api).forEach((fn) => fn.mockRejectedValue(new Error('x')))
    await addWorkspaceFromFolder()
    await importWorkspaceFile()
    await createWorkspace('n')
    await addFolderToWorkspace('w1')
    await removeFolderFromWorkspace('w1', folder)
    expect(diagError).toHaveBeenCalledTimes(5)
  })

  it('refreshes after a folder was added, not after a cancelled picker', async () => {
    api.addFolder.mockResolvedValueOnce(null).mockResolvedValueOnce(workspace)
    await addFolderToWorkspace('w1')
    expect(refresh).not.toHaveBeenCalled()
    await addFolderToWorkspace('w1')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('finds a folder by path ignoring slashes, trailing separators and drive-letter case', () => {
    expect(workspaceFolderAt(workspace, 'd:/work/app')).toBe(folder)
    expect(workspaceFolderAt(workspace, 'D:/Work/Other')).toBeNull()
    expect(workspaceFolderAt(null, 'D:/Work/App')).toBeNull()
    const posix: Workspace = { ...workspace, folders: [{ id: 'p', name: 'p', path: '/srv/App/' }] }
    expect(workspaceFolderAt(posix, '/srv/App')).not.toBeNull()
    expect(workspaceFolderAt(posix, '/srv/app')).toBeNull()
  })

  it('removing a folder resets the project filter only when it showed that folder', async () => {
    api.removeFolder.mockResolvedValue(undefined)
    useProjectFilterStore.setState({ filter: 'D:/Work/App' })
    await removeFolderFromWorkspace('w1', folder)
    expect(api.removeFolder).toHaveBeenCalledWith('w1', 'f1')
    expect(useProjectFilterStore.getState().filter).toBe('all')
    expect(refresh).toHaveBeenCalledTimes(1)

    useProjectFilterStore.setState({ filter: 'D:/Work/Elsewhere' })
    await removeFolderFromWorkspace('w1', folder)
    expect(useProjectFilterStore.getState().filter).toBe('D:/Work/Elsewhere')
  })
})
