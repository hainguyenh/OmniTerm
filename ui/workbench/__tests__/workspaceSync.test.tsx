/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyFsChange,
  initProjectTree,
  useProjectTree,
} from '../../ide/features/project-tree/store'
import { useProject } from '../../ide/platform/project'

describe('workspaceSync', () => {
  beforeEach(() => {
    act(() => {
      initProjectTree(null)
      useProject.setState({ project: null, settings: null })
    })
  })

  afterEach(() => {
    act(() => {
      initProjectTree(null)
      useProject.setState({ project: null, settings: null })
    })
  })

  it('synchronizes workspace root transition between workspaces and null', () => {
    // Initial: no workspace
    expect(useProjectTree.getState().root).toBeNull()

    // Switch to Workspace 1
    act(() => {
      initProjectTree('/workspaces/ws-1', 'ws-1')
    })
    expect(useProjectTree.getState().root).toBe('/workspaces/ws-1')
    expect(useProjectTree.getState().name).toBe('ws-1')
    expect(useProjectTree.getState().expanded.has('/workspaces/ws-1')).toBe(true)

    // Rapid switch to Workspace 2
    act(() => {
      initProjectTree('/workspaces/ws-2', 'ws-2')
    })
    expect(useProjectTree.getState().root).toBe('/workspaces/ws-2')
    expect(useProjectTree.getState().name).toBe('ws-2')
    expect(useProjectTree.getState().expanded.has('/workspaces/ws-2')).toBe(true)
    expect(useProjectTree.getState().expanded.has('/workspaces/ws-1')).toBe(false)

    // Switch to null (closing workspace)
    act(() => {
      initProjectTree(null)
    })
    expect(useProjectTree.getState().root).toBeNull()
    expect(useProjectTree.getState().name).toBe('')
    expect(useProjectTree.getState().expanded.size).toBe(0)
  })

  it('projects multi-root workspaces with members attached', () => {
    const memberRoots = ['/multi/root-a', '/multi/root-b', '/multi/root-c']

    act(() => {
      initProjectTree('/multi/root-a', 'MultiProj (+2)', memberRoots)
    })

    const state = useProjectTree.getState()
    expect(state.root).toBe('/multi/root-a')
    expect(state.name).toBe('MultiProj (+2)')
    expect(state.members).toEqual(memberRoots)

    // All member roots must be initially expanded
    for (const member of memberRoots) {
      expect(state.expanded.has(member)).toBe(true)
    }
  })

  it('handles incremental fsChanged events without resetting project roots', () => {
    act(() => {
      initProjectTree('/workspaces/watch-ws', 'watch-ws')
    })

    const rootBefore = useProjectTree.getState().root
    expect(rootBefore).toBe('/workspaces/watch-ws')

    // Dispatch fsChanged event
    act(() => {
      applyFsChange({
        created: ['/workspaces/watch-ws/new_file.ts'],
        modified: ['/workspaces/watch-ws/existing.ts'],
        removed: ['/workspaces/watch-ws/deleted.ts'],
        ignoreRules: [],
      })
    })

    const rootAfter = useProjectTree.getState().root
    expect(rootAfter).toBe('/workspaces/watch-ws')
    expect(useProjectTree.getState().expanded.has('/workspaces/watch-ws')).toBe(true)
  })
})
