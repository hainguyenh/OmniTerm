/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../ide/platform/ipc', () => ({
  isTauri: () => true,
  call: vi.fn(),
  commands: { settingsGet: async () => ({}), projectCurrent: vi.fn(), openProject: vi.fn(), closeProject: vi.fn(), lightEditOpen: vi.fn() },
  IpcError: class extends Error {},
}))

const workspace = {
  id: 'w1',
  name: 'Work',
  folders: [{ path: 'C:/code/a', name: 'a' }, { path: 'C:/code/b', name: 'b' }],
}

async function load() {
  vi.resetModules()
  const bridge = await import('../projectBridge')
  const trust = await import('../../ide/platform/projectTrust')
  const { useWorkspaceStore } = await import('../workspaceStore')
  useWorkspaceStore.setState({ workspaces: [workspace] } as never)
  return { ...bridge, ...trust }
}

describe('projectBridge trust', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ trusted: true, root: 'C:/code/a', name: 'a', displayName: 'a', isGit: false, settings: {} })
  })

  it('asks about every folder of the workspace before opening it', async () => {
    const { syncProject, provideProjectTrustPrompt } = await load()
    const asked: string[] = []
    provideProjectTrustPrompt(async (path, scope) => {
      asked.push(`${scope}:${path}`)
      return true
    })
    await syncProject('w1')
    expect(asked).toEqual(['local:C:/code/a', 'local:C:/code/b'])
    expect(invokeMock).toHaveBeenCalledWith('ide_set_project', { workspaceId: 'w1' })
  })

  it("does not open the workspace when the user chooses Don't Open", async () => {
    const { syncProject, provideProjectTrustPrompt } = await load()
    provideProjectTrustPrompt(async () => false)
    await expect(syncProject('w1')).rejects.toBeDefined()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('asks nothing when no workspace is selected', async () => {
    const { syncProject, provideProjectTrustPrompt } = await load()
    const prompt = vi.fn(async () => true)
    provideProjectTrustPrompt(prompt)
    await syncProject(null)
    expect(prompt).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith('ide_set_project', { workspaceId: null })
  })
})
