/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const settingsGet = vi.fn()
let tauri = true

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../ide/platform/ipc', () => ({
  isTauri: () => tauri,
  call: vi.fn(),
  commands: { settingsGet: () => settingsGet(), projectCurrent: vi.fn(), openProject: vi.fn(), closeProject: vi.fn(), lightEditOpen: vi.fn() },
  IpcError: class extends Error {},
}))

const projectInfo = (root: string) => ({
  trusted: true,
  root,
  name: 'A',
  displayName: 'A',
  isGit: false,
  settings: { editor: { fontSize: 14 } },
})

async function load() {
  vi.resetModules()
  const bridge = await import('../projectBridge')
  const { useProject } = await import('../../ide/platform/project')
  return { ...bridge, useProject }
}

describe('projectBridge', () => {
  beforeEach(() => {
    tauri = true
    invokeMock.mockReset()
    settingsGet.mockReset()
    settingsGet.mockResolvedValue({})
  })
  afterEach(() => vi.restoreAllMocks())

  it('reports the backend as unavailable outside Tauri without calling it', async () => {
    tauri = false
    const { probeIdeBackend } = await load()
    expect(await probeIdeBackend()).toBe(false)
    expect(settingsGet).not.toHaveBeenCalled()
  })

  it('probes once and shares the answer, also when the backend is missing', async () => {
    settingsGet.mockRejectedValue(new Error('command settings_get not found'))
    const { probeIdeBackend } = await load()
    expect(await probeIdeBackend()).toBe(false)
    expect(await probeIdeBackend()).toBe(false)
    expect(settingsGet).toHaveBeenCalledTimes(1)
  })

  it('publishes the project the backend returns for the workspace to useProject', async () => {
    invokeMock.mockResolvedValue(projectInfo('C:/work/a'))
    const { syncProject, useProject } = await load()
    await syncProject('ws-1')
    expect(invokeMock).toHaveBeenCalledWith('ide_set_project', { workspaceId: 'ws-1' })
    expect(useProject.getState().project?.root).toBe('C:/work/a')
    expect(useProject.getState().settings).toEqual({ editor: { fontSize: 14 } })
    expect(useProject.getState().lightEdit).toBe(false)
  })

  it('sends the projects a workspace indexes: none at first, then the ones the user chose', async () => {
    localStorage.clear()
    invokeMock.mockResolvedValue(projectInfo('C:/work/container'))
    const { syncProject } = await load()
    const { useWorkspaceStore } = await import('../workspaceStore')
    const folders = [{ id: 'a', name: 'a', path: 'C:/work/a' }, { id: 'b', name: 'b', path: 'C:/work/b' }]
    useWorkspaceStore.setState({ workspaces: [{ id: 'multi', name: 'multi', order: 0, pins: [], folders }] } as never)
    await syncProject('multi')
    expect(invokeMock).toHaveBeenCalledWith('ide_set_project', { workspaceId: 'multi', indexFolders: [] })
    const { markIndexed } = await import('../indexScope')
    markIndexed({ id: 'multi', name: 'multi', order: 0, pins: [], folders }, 'C:/work/b')
    await syncProject('multi')
    expect(invokeMock).toHaveBeenLastCalledWith('ide_set_project', { workspaceId: 'multi', indexFolders: ['C:/work/b'] })
  })

  it('clears the project when no workspace is selected', async () => {
    invokeMock.mockResolvedValueOnce(projectInfo('C:/work/a')).mockResolvedValueOnce(null)
    const { syncProject, useProject } = await load()
    await syncProject('ws-1')
    await syncProject(null)
    expect(invokeMock).toHaveBeenLastCalledWith('ide_set_project', { workspaceId: null })
    expect(useProject.getState().project).toBeNull()
  })

  it('drops the answer for a workspace the user already left', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    invokeMock
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValueOnce(projectInfo('C:/work/b'))
    const { syncProject, useProject } = await load()
    const first = syncProject('ws-1')
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1))
    await syncProject('ws-2')
    releaseFirst(projectInfo('C:/work/a'))
    await first
    expect(useProject.getState().project?.root).toBe('C:/work/b')
  })

  it('leaves useProject alone when the backend is not there', async () => {
    settingsGet.mockRejectedValue(new Error('missing'))
    const { syncProject, useProject } = await load()
    expect(await syncProject('ws-1')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
    expect(useProject.getState().project).toBeNull()
  })

  it('shows the opening state only when the backend is slow, and clears it when done', async () => {
    vi.useFakeTimers()
    try {
      let release: (value: unknown) => void = () => {}
      invokeMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
      const { syncProject, useProject, OPENING_DELAY_MS } = await load()
      const { useWorkspaceStore } = await import('../workspaceStore')
      useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'One', order: 0, pins: [], folders: [{ id: 'f', path: 'C:/work/a' }] }] as never })
      const pending = syncProject('ws-1')
      await vi.advanceTimersByTimeAsync(OPENING_DELAY_MS - 10)
      expect(useProject.getState().openingPath).toBeNull()
      await vi.advanceTimersByTimeAsync(20)
      expect(useProject.getState()).toMatchObject({ opening: true, openingPath: 'C:/work/a' })
      release(projectInfo('C:/work/a'))
      await pending
      expect(useProject.getState()).toMatchObject({ opening: false, openingPath: null })
    } finally {
      vi.useRealTimers()
    }
  })

  // Regression: Index Project re-synced the open workspace and a slow answer covered the workbench
  // with the opening view, which looked like the app reloading.
  it('never shows the opening state for a quiet re-sync, however slow', async () => {
    vi.useFakeTimers()
    try {
      let release: (value: unknown) => void = () => {}
      invokeMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
      const { syncProject, useProject, OPENING_DELAY_MS } = await load()
      const { useWorkspaceStore } = await import('../workspaceStore')
      useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'One', order: 0, pins: [], folders: [{ id: 'f', path: 'C:/work/a' }] }] as never })
      const pending = syncProject('ws-1', { quiet: true })
      await vi.advanceTimersByTimeAsync(OPENING_DELAY_MS * 10)
      expect(useProject.getState()).toMatchObject({ opening: false, openingPath: null })
      release(projectInfo('C:/work/a'))
      await pending
      expect(useProject.getState().project?.root).toBe('C:/work/a')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never shows the opening state for a fast answer and clears it when the call fails', async () => {
    const { syncProject, useProject } = await load()
    invokeMock.mockResolvedValueOnce(projectInfo('C:/work/a'))
    await syncProject('ws-1')
    expect(useProject.getState().openingPath).toBeNull()
    useProject.setState({ opening: true, openingPath: 'x' })
    invokeMock.mockRejectedValueOnce(new Error('gone'))
    await expect(syncProject('ws-1')).rejects.toThrow('gone')
    expect(useProject.getState()).toMatchObject({ opening: false, openingPath: null })
  })
})
