/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/features/project-tree/ProjectView', () => ({
  ProjectView: () => <div data-testid="upstream-project-view">ProjectViewMock</div>,
}))

import {
  initProjectTree,
  useProjectTree,
} from '../../ide/features/project-tree/store'
import {
  executeAction,
  getAction,
  registerAction,
} from '../../ide/platform/actions'
import { useProject } from '../../ide/platform/project'
import { useContributions } from '../../ide/workbench/contributions'
import { ProjectToolWindow } from '../ProjectToolWindow'
import { registerProjectTreeActions } from '../projectTreeActions'
import { registerShellToolWindows } from '../registerShellToolWindows'
import { useTreeViewport } from './treeViewport'

describe('Project Tree & Workspace Empirical Stress Suite', () => {
  useTreeViewport()

  let cleanups: Array<() => void> = []

  beforeEach(() => {
    cleanups = []
    act(() => {
      initProjectTree(null)
      useProject.setState({ project: null, settings: null })
    })
    cleanups.push(registerProjectTreeActions())
    cleanups.push(registerShellToolWindows())
  })

  afterEach(() => {
    cleanup()
    while (cleanups.length > 0) {
      const dispose = cleanups.pop()
      dispose?.()
    }
    act(() => {
      initProjectTree(null)
      useProject.setState({ project: null, settings: null })
    })
    vi.restoreAllMocks()
  })

  it('survives 50 rapid cycles switching roots, multi-roots, and null without desync or memory leaks', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<ProjectToolWindow />)

    const workspaceStates = [
      {
        root: '/root-a',
        name: 'Alpha Project',
        members: null,
        expectedExpanded: ['/root-a'],
      },
      {
        root: '/root-b',
        name: 'Beta Monorepo (+2)',
        members: ['/root-b', '/root-b/packages/core', '/root-b/packages/ui'],
        expectedExpanded: ['/root-b', '/root-b/packages/core', '/root-b/packages/ui'],
      },
      {
        root: '/root-c',
        name: 'Gamma Project',
        members: null,
        expectedExpanded: ['/root-c'],
      },
      {
        root: null,
        name: '',
        members: null,
        expectedExpanded: [],
      },
    ]

    const CYCLES = 50
    let totalTransitions = 0

    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      for (const state of workspaceStates) {
        totalTransitions += 1

        act(() => {
          initProjectTree(state.root, state.name, state.members)
        })

        const treeState = useProjectTree.getState()
        expect(treeState.root).toBe(state.root)
        expect(treeState.name).toBe(state.name)
        expect(treeState.members).toEqual(state.members)

        // Strict verification of expanded paths set
        expect(treeState.expanded.size).toBe(state.expectedExpanded.length)
        for (const expectedPath of state.expectedExpanded) {
          expect(treeState.expanded.has(expectedPath)).toBe(true)
        }

        // Listings map must reset to 0 entries on each initProjectTree
        expect(treeState.listings.size).toBe(0)

        // DOM inspection
        if (state.root !== null) {
          expect(screen.getByTestId('project-tool-window')).toBeTruthy()
          expect(screen.getByTestId('upstream-project-view')).toBeTruthy()
          expect(screen.queryByTestId('project-empty-state')).toBeNull()
        } else {
          expect(screen.queryByTestId('project-tool-window')).toBeNull()
          expect(screen.queryByTestId('upstream-project-view')).toBeNull()
          expect(screen.getByTestId('project-empty-state')).toBeTruthy()
          expect(screen.getByTestId('project-open-folder-button')).toBeTruthy()
        }
      }
    }

    expect(totalTransitions).toBe(200)
    expect(errorSpy).not.toHaveBeenCalled()
    unmount()
  })

  it('handles interleaved workspace switching and rapid mount/unmount cycles', () => {
    for (let round = 0; round < 30; round += 1) {
      const { unmount } = render(<ProjectToolWindow />)
      expect(screen.getByTestId('project-empty-state')).toBeTruthy()

      // Switch to active root
      act(() => {
        initProjectTree(`/project-round-${round}`, `Round ${round}`)
      })
      expect(screen.getByTestId('project-tool-window')).toBeTruthy()

      // Rapidly unmount and remount
      unmount()

      // Render again and verify clean re-mount
      const remount = render(<ProjectToolWindow />)
      expect(screen.getByTestId('project-tool-window')).toBeTruthy()

      // Switch back to null
      act(() => {
        initProjectTree(null)
      })
      expect(screen.getByTestId('project-empty-state')).toBeTruthy()

      remount.unmount()
    }
  })

  it('resiliently handles action edge cases', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const locateSpy = vi.fn()
    const unregisterLocate = registerAction({
      id: 'navigate.selectInProjectView',
      title: 'Locate Target',
      run: (c) => locateSpy(c.arg),
    })

    try {
      // 1. terminal.openAt with undefined, null, or empty arguments must not throw
      const openAt = getAction('terminal.openAt')
      expect(openAt).toBeDefined()

      expect(() => openAt?.run({ ctx: {}, arg: undefined })).not.toThrow()
      expect(dispatchSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'omniterm:new-session',
          detail: { cwd: undefined },
        }),
      )

      expect(() => openAt?.run({ ctx: {}, arg: null })).not.toThrow()
      expect(() => openAt?.run({ ctx: {}, arg: {} })).not.toThrow()
      expect(() => openAt?.run({ ctx: {}, arg: { cwd: '/valid/cwd/path' } })).not.toThrow()
      expect(dispatchSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'omniterm:new-session',
          detail: { cwd: '/valid/cwd/path' },
        }),
      )

      // 2. p5.tree.toolbar.locate must forward arguments correctly
      await executeAction('p5.tree.toolbar.locate', '/test/file.ts')
      expect(locateSpy).toHaveBeenCalledWith('/test/file.ts')
    } finally {
      unregisterLocate()
      dispatchSpy.mockRestore()
    }
  })

  it('confirms tool window registration invariants in tool window layout', () => {
    const tw = useContributions.getState().toolWindows.get('project')
    expect(tw).toBeDefined()
    expect(tw?.id).toBe('project')
    expect(tw?.title).toBe('Project')
    expect(tw?.icon).toBe('toolwindow-project')
    expect(tw?.anchor).toBe('left')
    expect(tw?.order).toBe(0)
    expect(tw?.requiresProject).toBe(false)
    expect(tw?.component).toBe(ProjectToolWindow)
  })
})
