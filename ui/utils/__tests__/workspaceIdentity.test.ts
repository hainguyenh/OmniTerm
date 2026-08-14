import { describe, expect, it } from 'vitest'
import type { Connection, Workspace } from '@omniterm/contract'
import { workspaceForConnection } from '../workspaceIdentity'

const workspace = (id: string, paths: string[]): Workspace => ({
  id,
  name: id,
  folders: paths.map((path, index) => ({ id: `${id}-${index}`, name: path, path })),
  order: 0,
  pins: [],
})

describe('workspaceForConnection', () => {
  it('matches local cwd against the longest composite workspace folder root', () => {
    const parent = workspace('parent', ['C:/projects'])
    const child = workspace('child', ['C:/projects/app', 'D:/other'])
    const connection = { type: 'LOCAL', localCwd: 'C:/projects/app/src' } as Connection

    expect(workspaceForConnection([parent, child], connection)?.id).toBe('child')
  })

  it('prefers explicit workspace identity and rejects unrelated cwd', () => {
    const selected = workspace('selected', ['C:/selected'])
    const other = workspace('other', ['C:/other'])

    expect(workspaceForConnection([selected, other], {
      type: 'LOCAL',
      localCwd: 'C:/outside',
      workspaceId: 'other',
    } as Connection)?.id).toBe('other')
    expect(workspaceForConnection([selected, other], {
      type: 'LOCAL',
      localCwd: 'C:/outside',
    } as Connection)).toBeUndefined()
  })
})
