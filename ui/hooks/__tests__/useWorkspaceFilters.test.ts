/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Workspace } from '@omniterm/contract'
import {
  useWorkspaceFilters,
  areFiltersEqual,
} from '../useWorkspaceFilters'
import {
  DEFAULT_FOLDER_FILTER,
  DEFAULT_TREE_FILTER,
  type TreeFilter,
} from '../../utils/workspaceFilter'

describe('useWorkspaceFilters', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const mockWorkspaces: Workspace[] = [
    {
      id: 'ws-1',
      name: 'Workspace 1',
      order: 0,
      pins: [],
      folders: [
        { id: 'f-1', name: 'Project Alpha', path: 'D:/repos/alpha' },
        { id: 'f-2', name: 'Project Beta', path: 'D:/repos/beta' },
      ],
    },
  ]

  it('provides default filter for unknown workspace', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    expect(result.current.filterOf('ws-1')).toEqual(DEFAULT_TREE_FILTER)
  })

  it('updates workspace filter and persists to localStorage', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    const customFilter: TreeFilter = {
      mode: 'scripts',
      kinds: ['ps1'],
      paths: [],
      showEmptyDirs: true,
    }

    act(() => {
      result.current.setWorkspaceFilter('ws-1', customFilter)
    })

    expect(result.current.filterOf('ws-1')).toEqual(customFilter)
    expect(JSON.parse(localStorage.getItem('cc.workspaceFilters') || '{}')).toEqual({
      'ws-1': customFilter,
    })
  })

  it('applies project default filter per root project when no folder override exists', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    const alphaDefault: TreeFilter = {
      mode: 'types',
      kinds: ['ts', 'tsx'],
      paths: [],
      showEmptyDirs: false,
    }

    // Set default for alpha by folder path
    act(() => {
      result.current.setProjectDefaultFilter('D:/repos/alpha', alphaDefault)
    })

    // Alpha gets the project default
    expect(result.current.getFolderFilter('ws-1', 'f-1', 'D:/repos/alpha')).toEqual(alphaDefault)
    // Beta without default gets DEFAULT_FOLDER_FILTER
    expect(result.current.getFolderFilter('ws-1', 'f-2', 'D:/repos/beta')).toEqual(DEFAULT_FOLDER_FILTER)

    // Resolved folder filters for workspace includes alpha
    expect(result.current.resolvedFolderFilters['ws-1']).toEqual({
      'f-1': alphaDefault,
    })
  })

  it('folder override takes precedence over project default filter', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    const projectDefault: TreeFilter = {
      mode: 'scripts',
      kinds: ['sh'],
      paths: [],
      showEmptyDirs: false,
    }
    const sessionOverride: TreeFilter = {
      mode: 'selected',
      kinds: [],
      paths: ['f-1/main.sh'],
      showEmptyDirs: true,
    }

    act(() => {
      result.current.setProjectDefaultFilter('D:/repos/alpha', projectDefault)
      result.current.setFolderFilter('ws-1', 'f-1', sessionOverride)
    })

    expect(result.current.getFolderFilter('ws-1', 'f-1', 'D:/repos/alpha')).toEqual(sessionOverride)

    // Clearing override falls back to project default
    act(() => {
      result.current.clearFolderFilterOverride('ws-1', 'f-1')
    })
    expect(result.current.getFolderFilter('ws-1', 'f-1', 'D:/repos/alpha')).toEqual(projectDefault)
  })

  it('clearing project default filter reverts to DEFAULT_FOLDER_FILTER', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    const projectDefault: TreeFilter = {
      mode: 'scripts',
      kinds: ['sh'],
      paths: [],
      showEmptyDirs: false,
    }

    act(() => {
      result.current.setProjectDefaultFilter('f-2', projectDefault)
    })
    expect(result.current.getFolderFilter('ws-1', 'f-2')).toEqual(projectDefault)

    act(() => {
      result.current.clearProjectDefaultFilter('f-2')
    })
    expect(result.current.getFolderFilter('ws-1', 'f-2')).toEqual(DEFAULT_FOLDER_FILTER)
  })

  it('manages filterMenu open and close states', () => {
    const { result } = renderHook(() => useWorkspaceFilters(mockWorkspaces))
    const dummyAnchor = new DOMRect(10, 20, 100, 30)

    act(() => {
      result.current.openFilterMenu('ws-1', dummyAnchor)
    })
    expect(result.current.filterMenu).toEqual({
      workspaceId: 'ws-1',
      anchor: dummyAnchor,
    })

    // Toggle off
    act(() => {
      result.current.openFilterMenu('ws-1', dummyAnchor)
    })
    expect(result.current.filterMenu).toBeNull()

    // Open folder filter menu
    act(() => {
      result.current.openFolderFilterMenu('ws-1', 'f-1', 'Project Alpha', dummyAnchor, 'D:/repos/alpha')
    })
    expect(result.current.filterMenu).toEqual({
      workspaceId: 'ws-1',
      folderId: 'f-1',
      folderName: 'Project Alpha',
      folderPath: 'D:/repos/alpha',
      anchor: dummyAnchor,
    })

    act(() => {
      result.current.closeFilterMenu()
    })
    expect(result.current.filterMenu).toBeNull()
  })

  it('areFiltersEqual accurately compares filters', () => {
    const filterA: TreeFilter = { mode: 'all', kinds: ['ts'], paths: ['a'], showEmptyDirs: false }
    const filterB: TreeFilter = { mode: 'all', kinds: ['ts'], paths: ['a'], showEmptyDirs: false }
    const filterC: TreeFilter = { mode: 'scripts', kinds: ['ts'], paths: ['a'], showEmptyDirs: false }
    const filterD: TreeFilter = { mode: 'all', kinds: ['js'], paths: ['a'], showEmptyDirs: false }

    expect(areFiltersEqual(filterA, filterB)).toBe(true)
    expect(areFiltersEqual(filterA, filterC)).toBe(false)
    expect(areFiltersEqual(filterA, filterD)).toBe(false)
  })
})
