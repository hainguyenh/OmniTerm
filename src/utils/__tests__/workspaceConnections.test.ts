/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { upsertWorkspaceConnection } from '../workspaceConnections'

const connection = (id: string, name = id): Connection => ({
  id,
  name,
  type: 'SSH',
  host: 'example.test',
  port: '22',
  user: 'root',
})

function setWorkspaceApi(existing: Connection[]) {
  const loadConnections = vi.fn().mockResolvedValue(existing)
  const saveConnections = vi.fn().mockResolvedValue(undefined)
  ;(window as any).omnitermAPI = { workspace: { loadConnections, saveConnections } }
  return { loadConnections, saveConnections }
}

describe('upsertWorkspaceConnection', () => {
  beforeEach(() => {
    delete (window as any).omnitermAPI
  })

  it('replaces a matching connection in edit mode without changing order', async () => {
    const api = setWorkspaceApi([connection('a'), connection('b')])
    await upsertWorkspaceConnection('workspace-1', connection('a', 'renamed'), true)
    expect(api.saveConnections).toHaveBeenCalledWith(
      'workspace-1',
      [connection('a', 'renamed'), connection('b')],
    )
  })

  it('appends for create mode or when an edit target no longer exists', async () => {
    const created = setWorkspaceApi([connection('a')])
    await upsertWorkspaceConnection('workspace-1', connection('b'), false)
    expect(created.saveConnections).toHaveBeenCalledWith('workspace-1', [connection('a'), connection('b')])

    const staleEdit = setWorkspaceApi([connection('a')])
    await upsertWorkspaceConnection('workspace-1', connection('b'), true)
    expect(staleEdit.saveConnections).toHaveBeenCalledWith('workspace-1', [connection('a'), connection('b')])
  })

  it('propagates a refused write to the caller', async () => {
    const api = setWorkspaceApi([])
    api.saveConnections.mockRejectedValueOnce(new Error('read-only workspace'))
    await expect(upsertWorkspaceConnection('workspace-1', connection('a'), false))
      .rejects.toThrow('read-only workspace')
  })
})
