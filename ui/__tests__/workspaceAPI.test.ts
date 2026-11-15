import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const open = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => open(...args) }))

import { createTempNotesAPI } from '../tempNotesAPI'
import { createWorkspaceAPI } from '../workspaceAPI'

const wire = { id: 'w', name: 'W', folders: [], order: 0 }

describe('createWorkspaceAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue(wire)
  })

  it('fills in missing pins when listing and creating', async () => {
    const api = createWorkspaceAPI()
    invoke.mockResolvedValueOnce([wire, { ...wire, id: 'x', pins: [{ folderId: 'f', path: 'p' }] }])
    const listed = await api.list()
    expect(listed[0]?.pins).toEqual([])
    expect(listed[1]?.pins).toHaveLength(1)
    invoke.mockResolvedValueOnce(null)
    await expect(api.list()).resolves.toEqual([])
    await expect(api.create('W')).resolves.toMatchObject({ pins: [] })
    invoke.mockResolvedValueOnce(undefined)
    await expect(api.create('W')).resolves.toMatchObject({ id: '', pins: [] })
  })

  it('adds workspaces and folders only when a path was picked', async () => {
    const api = createWorkspaceAPI()
    open.mockResolvedValueOnce('C:/proj')
    await expect(api.add()).resolves.toMatchObject({ id: 'w' })
    expect(invoke).toHaveBeenLastCalledWith('add_workspace', { path: 'C:/proj' })
    open.mockResolvedValueOnce(null)
    await expect(api.add()).resolves.toBeNull()
    open.mockResolvedValueOnce('C:/f')
    await api.addFolder('w')
    expect(invoke).toHaveBeenLastCalledWith('add_workspace_folder', { workspaceId: 'w', path: 'C:/f' })
    open.mockResolvedValueOnce(['x'])
    await expect(api.addFolder('w')).resolves.toBeNull()
    open.mockResolvedValueOnce('C:/a.code-workspace')
    await api.importFile()
    expect(invoke).toHaveBeenLastCalledWith('import_workspace_file', { path: 'C:/a.code-workspace' })
    open.mockResolvedValueOnce(null)
    await expect(api.importFile()).resolves.toBeNull()
  })

  it('forwards edits with null defaults for optional fields', async () => {
    const api = createWorkspaceAPI()
    await api.removeFolder('w', 'f')
    await api.renameFolder('w', 'f', 'n')
    await api.rename('w', 'n')
    await api.setAppearance('w')
    expect(invoke).toHaveBeenLastCalledWith('set_workspace_appearance', { workspaceId: 'w', color: null, icon: null })
    await api.setFolderColor('w', 'f')
    expect(invoke).toHaveBeenLastCalledWith('set_workspace_folder_color', { workspaceId: 'w', folderId: 'f', color: null })
    await api.setPinned('w', 'f', 'p', true)
    invoke.mockResolvedValueOnce([wire])
    await expect(api.move('w', null, 0)).resolves.toHaveLength(1)
    await api.remove('w')
    expect(invoke).toHaveBeenLastCalledWith('remove_workspace', { id: 'w' })
  })

  it('scans and runs scripts', async () => {
    const api = createWorkspaceAPI()
    await api.scanScripts('w')
    await api.scanFolders('w')
    await api.scanFolderEntries('w')
    expect(invoke).toHaveBeenLastCalledWith('scan_workspace_entries', { workspaceId: 'w', folder: '', offset: 0, limit: 2000 })
    await api.run({ workspaceId: 'w' })
    expect(invoke).toHaveBeenLastCalledWith('run_script', { workspaceId: 'w', script: null, subPath: null })
    await api.readScript('w', 'a.sh')
    await api.writeScript('w', 'a.sh', 'x')
  })

  it('returns the logical path of tree edits and rejects odd answers', async () => {
    const api = createWorkspaceAPI()
    invoke.mockResolvedValueOnce('f#1/dir')
    await expect(api.createDirectory('w', 'dir')).resolves.toBe('f#1/dir')
    invoke.mockResolvedValueOnce('f#1/b')
    await expect(api.moveFile('w', 'a', 'b')).resolves.toBe('f#1/b')
    invoke.mockResolvedValueOnce('')
    await expect(api.moveFile('w', 'a', 'b')).rejects.toThrow('unexpected response')
    invoke.mockResolvedValueOnce(4)
    await expect(api.createDirectory('w', 'd')).rejects.toThrow('could not be updated')
    await api.deleteFile('w', 'a')
  })

  it('treats a failing connection load as empty', async () => {
    const api = createWorkspaceAPI()
    invoke.mockRejectedValueOnce(new Error('x'))
    await expect(api.loadConnections('w')).resolves.toEqual([])
    await api.saveConnections('w', [])
    await api.deleteConnection('w', 'c')
    expect(invoke).toHaveBeenLastCalledWith('delete_workspace_connection', { workspaceId: 'w', connectionId: 'c' })
  })
})

describe('createTempNotesAPI', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards every note command', async () => {
    invoke.mockResolvedValue(undefined)
    const api = createTempNotesAPI()
    await api.list()
    await api.read('n')
    await api.write('n', 'text')
    await api.delete('n')
    await api.saveAs('n')
    expect(invoke).toHaveBeenLastCalledWith('save_temp_note_as', { id: 'n', suggestedName: null })
    await api.saveAs('n', 'name.txt')
    expect(invoke).toHaveBeenLastCalledWith('save_temp_note_as', { id: 'n', suggestedName: 'name.txt' })
  })
})
