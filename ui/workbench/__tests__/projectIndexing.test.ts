/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const confirmMock = vi.hoisted(() => vi.fn())
const syncProjectMock = vi.hoisted(() => vi.fn())
const notifyMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())
vi.mock('../../ide/workbench/contributions', () => ({ notifications: () => ({ notify: notifyMock, remove: removeMock }) }))
vi.mock('../../ide/workbench/messages', () => ({ confirm: (...args: unknown[]) => confirmMock(...args) }))
vi.mock('../../platform/projectBridge', () => ({ syncProject: (...args: unknown[]) => syncProjectMock(...args) }))

import type { Workspace } from '../../domain'
import { isIndexed } from '../../platform/indexScope'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { indexWorkspaceProject, offerToIndexDefault, offerToIndexOnOpen } from '../projectIndexing'

let seq = 0
const workspace = (paths: string[]): Workspace => ({
  id: `ws${++seq}`,
  name: 'ws',
  order: 0,
  pins: [],
  folders: paths.map((path, i) => ({ id: `f${i}`, name: `f${i}`, path })),
})

describe('projectIndexing', () => {
  beforeEach(() => {
    localStorage.clear()
    confirmMock.mockReset()
    syncProjectMock.mockReset()
    notifyMock.mockReset()
    removeMock.mockReset()
    syncProjectMock.mockResolvedValue(null)
  })

  it('asks to index a new default project that is not indexed, and indexes it on yes', async () => {
    const ws = workspace(['D:/work/a', 'D:/work/b'])
    useWorkspaceStore.setState({ workspaces: [ws], selection: ws.id } as never)
    confirmMock.mockResolvedValue(true)

    await offerToIndexDefault(ws, 'D:/work/b')

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Index Project?', ok: 'Index' }))
    expect(isIndexed(ws, 'D:/work/b')).toBe(true)
    expect(syncProjectMock).toHaveBeenCalledWith(ws.id)
  })

  it('does not ask again this session after the user declined', async () => {
    const ws = workspace(['D:/work/a', 'D:/work/b'])
    confirmMock.mockResolvedValue(false)

    await offerToIndexDefault(ws, 'D:/work/b')
    await offerToIndexDefault(ws, 'D:/work/b')

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(isIndexed(ws, 'D:/work/b')).toBe(false)
    expect(syncProjectMock).not.toHaveBeenCalled()
  })

  it('never asks for an indexed project', async () => {
    const multi = workspace(['D:/work/a', 'D:/work/b'])
    await indexWorkspaceProject(multi, 'D:/work/a')
    await offerToIndexDefault(multi, 'D:/work/a')
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('offers once, on open, to index the default project of a workspace with nothing indexed', async () => {
    const ws = workspace(['D:/work/solo'])
    useWorkspaceStore.setState({ workspaces: [ws], selection: ws.id } as never)
    offerToIndexOnOpen(ws)
    offerToIndexOnOpen(ws)
    expect(notifyMock).toHaveBeenCalledTimes(1)
    const shown = notifyMock.mock.calls[0]![0] as { title: string; actions: { label: string; run: () => void }[] }
    expect(shown.title).toBe('Project not indexed')
    expect(shown.actions.map((a) => a.label)).toEqual(['Index', 'Not Now'])

    shown.actions[0]!.run()
    await vi.waitFor(() => expect(syncProjectMock).toHaveBeenCalledWith(ws.id))
    expect(isIndexed(ws, 'D:/work/solo')).toBe(true)
    expect(removeMock).toHaveBeenCalled()
  })

  it('does not offer when a project is already indexed', async () => {
    const ws = workspace(['D:/work/a', 'D:/work/b'])
    await indexWorkspaceProject(ws, 'D:/work/b')
    offerToIndexOnOpen(ws)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('records a project of a workspace that is not open without reopening anything', async () => {
    const ws = workspace(['D:/work/a', 'D:/work/b'])
    useWorkspaceStore.setState({ workspaces: [ws], selection: 'elsewhere' } as never)

    expect(await indexWorkspaceProject(ws, 'D:/work/b')).toBe(true)
    expect(await indexWorkspaceProject(ws, 'D:/work/b')).toBe(false)
    expect(syncProjectMock).not.toHaveBeenCalled()
  })
})
