/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import type { Connection, Workspace } from '@omniterm/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGitProjects } from '../useGitProjects'

const STORAGE_KEY = 'omniterm:selected-git-project'

const workspace = (folders: Workspace['folders'], name = 'Space'): Workspace => ({
  id: `ws-${name}`,
  name,
  order: 0,
  pins: [],
  folders,
})

const connection = (id: string, type: Connection['type'], localCwd?: string): Connection => ({
  id,
  name: `Conn ${id}`,
  type,
  host: '',
  port: '',
  user: '',
  localCwd,
})

describe('useGitProjects', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aggregates workspace, connection, terminal, and stored folders without duplicates', () => {
    localStorage.setItem(STORAGE_KEY, 'D:\\Custom\\Proj\\')
    const workspaces = [
      workspace([
        { id: 'f1', name: '', path: 'C:\\Repo\\' },
        { id: 'f2', name: 'Empty', path: '' },
        { id: 'f3', name: 'Dup', path: 'c:/repo' },
      ]),
    ]
    const connections = [
      connection('local', 'LOCAL', '/home/me/app'),
      connection('nocwd', 'LOCAL'),
      connection('ssh', 'SSH', '/srv/remote'),
    ]
    const { result } = renderHook(() => useGitProjects(workspaces, '/term/cwd', connections))

    expect(result.current.projects).toEqual([
      { id: 'wf:f1', name: 'Space', path: 'C:/Repo', category: 'Workspace' },
      { id: 'conn:local', name: 'Conn local', path: '/home/me/app', category: 'Connection' },
      { id: 'active:cwd', name: 'Active Terminal', path: '/term/cwd', category: 'Terminal' },
      { id: 'custom:D:/Custom/Proj', name: 'Proj', path: 'D:/Custom/Proj', category: 'Folder' },
    ])
    expect(result.current.activePath).toBe('D:/Custom/Proj')
  })

  it('does not duplicate a stored selection that is already a candidate', () => {
    localStorage.setItem(STORAGE_KEY, 'C:/REPO')
    const { result } = renderHook(() => useGitProjects([workspace([{ id: 'f', name: 'Repo', path: 'C:/Repo' }])]))
    expect(result.current.projects).toHaveLength(1)
    expect(result.current.activePath).toBe('C:/Repo')
  })

  it('resolves the active terminal folder, its normalized form, or the first project', () => {
    const ws = [workspace([{ id: 'f', name: 'Repo', path: '/repo' }])]
    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string | undefined }) => useGitProjects(ws, cwd),
      { initialProps: { cwd: '/term/' as string | undefined } },
    )
    expect(result.current.activePath).toBe('/term')

    rerender({ cwd: '/' })
    expect(result.current.activePath).toBe('')
    expect(result.current.projects.map((p) => p.path)).toEqual(['/repo'])

    rerender({ cwd: undefined })
    expect(result.current.activePath).toBe('/repo')
  })

  it('returns no active path without any candidates and ignores blank stored selections', () => {
    localStorage.setItem(STORAGE_KEY, '   ')
    const { result } = renderHook(() => useGitProjects())
    expect(result.current.projects).toEqual([])
    expect(result.current.activePath).toBeNull()
  })

  it('persists selections and broadcasts them to other instances', () => {
    const listener = vi.fn()
    window.addEventListener('omniterm:git-project-change', listener)
    const first = renderHook(() => useGitProjects([], '/a'))
    const second = renderHook(() => useGitProjects([], '/a'))

    act(() => {
      first.result.current.selectProject('E:\\Work\\Next\\')
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('E:/Work/Next')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(first.result.current.activePath).toBe('E:/Work/Next')
    expect(second.result.current.activePath).toBe('E:/Work/Next')

    act(() => {
      window.dispatchEvent(new CustomEvent('omniterm:git-project-change'))
      window.dispatchEvent(new CustomEvent('omniterm:git-project-change', { detail: { path: '' } }))
    })
    expect(second.result.current.activePath).toBe('E:/Work/Next')
    window.removeEventListener('omniterm:git-project-change', listener)
  })

  it('keeps working when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useGitProjects([], '/a'))
    expect(result.current.activePath).toBe('/a')
    act(() => {
      result.current.selectProject('/b')
    })
    expect(result.current.activePath).toBe('/b')
  })
})
