/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Workspace } from '../../domain'
import { defaultFolder, indexedFolders, isIndexed, markIndexed, storeDefaults } from '../indexScope'

let seq = 0
const workspace = (folders: { path: string; disabled?: boolean }[], id = `ws${++seq}`): Workspace => ({
  id,
  name: 'ws',
  order: 0,
  pins: [],
  folders: folders.map((folder, i) => ({ id: `f${i}`, name: `f${i}`, ...folder })),
})

describe('indexScope', () => {
  beforeEach(() => localStorage.clear())

  // Regression: opening a workspace indexed its default project on its own and the app lagged.
  it('indexes nothing until the user chooses a project, not even the default one', () => {
    const ws = workspace([{ path: 'D:/work/a', disabled: true }, { path: 'D:/work/b' }, { path: 'D:/work/c' }])
    expect(indexedFolders(ws)).toEqual([])
    expect(indexedFolders(workspace([{ path: 'D:/work/single' }]))).toEqual([])
  })

  it('names the chosen default project, else the first active one', () => {
    const ws = workspace([{ path: 'D:/work/a', disabled: true }, { path: 'D:/work/b' }, { path: 'D:/work/c' }], 'ws')
    expect(defaultFolder(ws)).toBe('D:/work/b')
    storeDefaults({ ws: 'D:\\work\\c\\' })
    expect(defaultFolder(ws)).toBe('D:/work/c')
  })

  it('adds a project once, in any spelling', () => {
    const ws = workspace([{ path: 'D:/work/a' }, { path: 'D:/work/b' }])
    expect(isIndexed(ws, 'D:/work/b')).toBe(false)
    expect(markIndexed(ws, 'd:\\work\\b')).toBe(true)
    expect(markIndexed(ws, 'D:/work/b/')).toBe(false)
    expect(isIndexed(ws, 'D:/work/b')).toBe(true)
    expect(indexedFolders(ws)).toEqual(['D:/work/b'])
  })

  // Regression: a project indexed once was indexed again on every start, without asking.
  it('keeps the choice for this session only, and drops what earlier builds stored', async () => {
    const ws = workspace([{ path: 'D:/work/a' }, { path: 'D:/work/b' }])
    markIndexed(ws, 'D:/work/b')
    expect(localStorage.length).toBe(0)

    localStorage.setItem('omniterm.workspace.indexedProjects', JSON.stringify({ [ws.id]: ['D:/work/a'] }))
    vi.resetModules()
    const restarted = await import('../indexScope')
    expect(restarted.indexedFolders(ws)).toEqual([])
    expect(localStorage.getItem('omniterm.workspace.indexedProjects')).toBeNull()
  })
})
