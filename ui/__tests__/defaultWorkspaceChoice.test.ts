import { describe, expect, it } from 'vitest'
import {
  defaultWorkspaceToSelection,
  isSelectionLive,
  resolveNewSessionWorkspace,
  type DefaultWorkspaceSetting,
} from '../utils/workspaceSelection'

const workspaces = [
  { id: 'ws1', folders: [{ id: 'f1' }, { id: 'f2' }] },
  { id: 'ws2', folders: [] },
]

describe('defaultWorkspaceToSelection', () => {
  it('encodes a workspace-mode setting as a plain workspace id', () => {
    const setting: DefaultWorkspaceSetting = { mode: 'workspace', workspaceId: 'ws1' }
    expect(defaultWorkspaceToSelection(setting)).toBe('ws1')
  })

  it('encodes a folder-mode setting with the :: separator', () => {
    const setting: DefaultWorkspaceSetting = { mode: 'folder', workspaceId: 'ws1', folderId: 'f2' }
    expect(defaultWorkspaceToSelection(setting)).toBe('ws1::f2')
  })

  it('maps home and missing settings to null so the chain keeps falling through', () => {
    expect(defaultWorkspaceToSelection({ mode: 'home' })).toBeNull()
    expect(defaultWorkspaceToSelection(undefined)).toBeNull()
  })
})

describe('isSelectionLive', () => {
  it('accepts an existing workspace without folders', () => {
    expect(isSelectionLive(workspaces, 'ws2')).toBe(true)
  })

  it('accepts an existing workspace+folder pair', () => {
    expect(isSelectionLive(workspaces, 'ws1::f1')).toBe(true)
  })

  it('rejects deleted workspaces and deleted folders', () => {
    expect(isSelectionLive(workspaces, 'ws-deleted')).toBe(false)
    expect(isSelectionLive(workspaces, 'ws1::f-deleted')).toBe(false)
  })
})

describe('resolveNewSessionWorkspace', () => {
  it('an explicit selection always wins, including an explicit null (forced home)', () => {
    const setting: DefaultWorkspaceSetting = { mode: 'workspace', workspaceId: 'ws1' }
    expect(resolveNewSessionWorkspace('ws2', setting, 'last')).toBe('ws2')
    expect(resolveNewSessionWorkspace(null, setting, 'last')).toBeNull()
  })

  it('falls through to the default setting when no explicit arg is given', () => {
    const setting: DefaultWorkspaceSetting = { mode: 'workspace', workspaceId: 'ws1' }
    expect(resolveNewSessionWorkspace(undefined, setting, 'last')).toBe('ws1')
  })

  it('a stale default setting falls through to last-used, then home', () => {
    const setting: DefaultWorkspaceSetting = { mode: 'folder', workspaceId: 'gone', folderId: 'gone-folder' }
    const isLive = (selection: string) => isSelectionLive(workspaces, selection)
    expect(resolveNewSessionWorkspace(undefined, setting, 'ws2', isLive)).toBe('ws2')
    expect(resolveNewSessionWorkspace(undefined, setting, null, isLive)).toBeNull()
  })

  it('stale last-used falls through to home instead of failing the launch', () => {
    const isLive = (selection: string) => isSelectionLive(workspaces, selection)
    expect(resolveNewSessionWorkspace(undefined, undefined, 'gone', isLive)).toBeNull()
  })
})
