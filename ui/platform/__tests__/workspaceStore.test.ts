/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Workspace } from '../../domain'

import {
  isAllScope,
  LAST_WORKSPACE_KEY,
  scopedWorkspaceId,
  selectedWorkspaceId,
  useWorkspaceStore,
  WORKSPACE_SCOPE_KEY,
} from '../workspaceStore'
import { useProjectFilterStore } from '../../workbench/projectFilterStore'

const ws = (id: string, folders: string[]): Workspace => ({
  id,
  name: id,
  order: 0,
  pins: [],
  folders: folders.map((f) => ({ id: f, path: `C:/${f}` })) as Workspace['folders'],
})

function setCatalog(list: Workspace[]) {
  window.omnitermAPI = { ...window.omnitermAPI, workspace: { list: vi.fn().mockResolvedValue(list) } as never }
}

describe('workspace store', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.setState({ workspaces: [], loaded: false, selection: null, scope: 'workspace' })
    useProjectFilterStore.getState().reset()
  })

  it('loads the catalog and selects the first workspace that has folders', async () => {
    setCatalog([ws('empty', []), ws('a', ['f1'])])
    await useWorkspaceStore.getState().refresh()
    expect(useWorkspaceStore.getState().selection).toBe('a::f1')
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('a::f1')
  })

  it('keeps a still-valid selection and replaces a stale one', async () => {
    setCatalog([ws('a', ['f1']), ws('b', ['g1', 'g2'])])
    useWorkspaceStore.setState({ selection: 'b::g2' })
    await useWorkspaceStore.getState().refresh()
    expect(useWorkspaceStore.getState().selection).toBe('b::g2')
    useWorkspaceStore.setState({ selection: 'gone::x' })
    await useWorkspaceStore.getState().refresh()
    expect(useWorkspaceStore.getState().selection).toBe('a::f1')
  })

  it('survives a failing catalog read', async () => {
    window.omnitermAPI = { ...window.omnitermAPI, workspace: { list: vi.fn().mockRejectedValue(new Error('x')) } as never }
    await useWorkspaceStore.getState().refresh()
    expect(useWorkspaceStore.getState()).toMatchObject({ workspaces: [], loaded: true })
  })

  it('selectWorkspace switches the one shared selection and resets the project filter', () => {
    useWorkspaceStore.setState({ workspaces: [ws('a', ['f1']), ws('b', ['g1']), ws('empty', [])], selection: 'a::f1' })
    useProjectFilterStore.getState().setFilter('C:/f1')
    useWorkspaceStore.getState().selectWorkspace('b')
    expect(useWorkspaceStore.getState().selection).toBe('b::g1')
    expect(useProjectFilterStore.getState().filter).toBe('all')
    useWorkspaceStore.getState().selectWorkspace('empty')
    expect(selectedWorkspaceId(useWorkspaceStore.getState().selection)).toBe('empty')
  })

  it('does not reset the filter when only the folder of the same workspace changes', () => {
    useWorkspaceStore.setState({ workspaces: [ws('a', ['f1', 'f2'])], selection: 'a::f1' })
    useProjectFilterStore.getState().setFilter('C:/f2')
    useWorkspaceStore.getState().setSelection('a::f2')
    expect(useProjectFilterStore.getState().filter).toBe('C:/f2')
  })

  it('setSelection accepts an updater and clears storage for null', () => {
    useWorkspaceStore.getState().setSelection('a')
    useWorkspaceStore.getState().setSelection((c) => `${c}::f`)
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('a::f')
    useWorkspaceStore.getState().setSelection(null)
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBeNull()
  })

  it('scopes Sessions and Connections to every workspace only while there are several', () => {
    useWorkspaceStore.setState({ workspaces: [ws('a', ['f1'])], selection: 'a::f1' })
    useWorkspaceStore.getState().setScope('all')
    expect(localStorage.getItem(WORKSPACE_SCOPE_KEY)).toBe('all')
    expect(isAllScope(useWorkspaceStore.getState())).toBe(false)
    expect(scopedWorkspaceId(useWorkspaceStore.getState())).toBe('a')
    useWorkspaceStore.setState({ workspaces: [ws('a', ['f1']), ws('b', ['g1'])] })
    expect(isAllScope(useWorkspaceStore.getState())).toBe(true)
    expect(scopedWorkspaceId(useWorkspaceStore.getState())).toBeNull()
  })

  it('selecting a workspace scopes back to it and forgets the stored scope', () => {
    useWorkspaceStore.setState({ workspaces: [ws('a', ['f1']), ws('b', ['g1'])], selection: 'a::f1' })
    useWorkspaceStore.getState().setScope('all')
    useWorkspaceStore.getState().selectWorkspace('b')
    expect(useWorkspaceStore.getState().scope).toBe('workspace')
    expect(localStorage.getItem(WORKSPACE_SCOPE_KEY)).toBeNull()
  })
})
