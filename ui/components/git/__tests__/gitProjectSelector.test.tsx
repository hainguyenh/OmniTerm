/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Workspace } from '@omniterm/contract'
import { GitProjectSelector } from '../GitProjectSelector'
import { useGitProjects } from '../useGitProjects'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'git_status') {
      return Promise.resolve({
        repo_root: '/repo',
        branch: 'main',
        upstream: null,
        ahead: 0,
        behind: 0,
        is_detached: false,
        conflict_count: 0,
        files: [],
      })
    }
    if (cmd === 'git_log') {
      return Promise.resolve([])
    }
    return Promise.resolve(null)
  }),
}))

describe('GitProjectSelector', () => {
  const mockProjects = [
    { id: '1', name: 'OmniTerm', path: 'D:/workspace/OmniTerm', category: 'Workspace' },
    { id: '2', name: 'Backend', path: 'D:/workspace/Backend', category: 'Workspace' },
  ]

  it('renders dropdown with projects and handles selection', () => {
    const onSelect = vi.fn()
    render(
      <GitProjectSelector
        projects={mockProjects}
        selectedPath="D:/workspace/OmniTerm"
        onSelectProject={onSelect}
      />,
    )

    const select = screen.getByRole('combobox', { name: /Select Git Project/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByText('OmniTerm (D:/workspace/OmniTerm)')).toBeInTheDocument()
    expect(screen.getByText('Backend (D:/workspace/Backend)')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'D:/workspace/Backend' } })
    expect(onSelect).toHaveBeenCalledWith('D:/workspace/Backend')
  })

  it('returns null when projects list is empty', () => {
    const { container } = render(
      <GitProjectSelector
        projects={[]}
        selectedPath={null}
        onSelectProject={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('useGitProjects', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('aggregates projects from workspaces, connections, and active cwd', () => {
    const mockWorkspaces: Workspace[] = [
      {
        id: 'ws-1',
        name: 'Work',
        order: 0,
        pins: [],
        folders: [
          { id: 'f-1', name: 'Repo1', path: 'C:\\Projects\\Repo1' },
        ],
      },
    ]

    const mockConnections: Connection[] = [
      {
        id: 'conn-1',
        name: 'Local Shell',
        type: 'LOCAL',
        host: '',
        port: '',
        user: '',
        localCwd: 'C:\\Projects\\LocalConn',
      },
      {
        id: 'conn-2',
        name: 'SSH Shell',
        type: 'SSH',
        host: 'remote.server',
        port: '22',
        user: 'root',
      },
    ]

    const { result } = renderHook(() =>
      useGitProjects(mockWorkspaces, 'C:\\Projects\\ActiveCwd', mockConnections),
    )

    expect(result.current.projects).toHaveLength(3)
    expect(result.current.projects[0].path).toBe('C:/Projects/Repo1')
    expect(result.current.projects[1].path).toBe('C:/Projects/LocalConn')
    expect(result.current.projects[2].path).toBe('C:/Projects/ActiveCwd')
    expect(result.current.activePath).toBe('C:/Projects/ActiveCwd')
  })

  it('defaults to first workspace project when no active cwd is provided', () => {
    const mockWorkspaces: Workspace[] = [
      {
        id: 'ws-1',
        name: 'Work',
        order: 0,
        pins: [],
        folders: [
          { id: 'f-1', name: 'Repo1', path: 'C:\\Projects\\Repo1' },
        ],
      },
    ]

    const { result } = renderHook(() =>
      useGitProjects(mockWorkspaces, undefined, []),
    )

    expect(result.current.activePath).toBe('C:/Projects/Repo1')
  })

  it('deduplicates case-insensitively and handles path normalization', () => {
    const mockWorkspaces: Workspace[] = [
      {
        id: 'ws-1',
        name: 'Work',
        order: 0,
        pins: [],
        folders: [
          { id: 'f-1', name: 'Repo1', path: 'C:/Projects/Repo1/' },
          { id: 'f-2', name: 'Repo1 Duplicate', path: 'c:\\projects\\repo1' },
        ],
      },
    ]

    const { result } = renderHook(() =>
      useGitProjects(mockWorkspaces, 'C:/projects/repo1'),
    )

    expect(result.current.projects).toHaveLength(1)
    expect(result.current.projects[0].path).toBe('C:/Projects/Repo1')
  })

  it('selects project, stores in localStorage, and responds to external events', () => {
    const mockWorkspaces: Workspace[] = [
      {
        id: 'ws-1',
        name: 'Work',
        order: 0,
        pins: [],
        folders: [
          { id: 'f-1', name: 'Repo1', path: 'C:/Projects/Repo1' },
          { id: 'f-2', name: 'Repo2', path: 'C:/Projects/Repo2' },
        ],
      },
    ]

    const { result } = renderHook(() => useGitProjects(mockWorkspaces))

    expect(result.current.activePath).toBe('C:/Projects/Repo1')

    act(() => {
      result.current.selectProject('C:/Projects/Repo2')
    })

    expect(result.current.activePath).toBe('C:/Projects/Repo2')
    expect(localStorage.getItem('omniterm:selected-git-project')).toBe('C:/Projects/Repo2')

    // Dispatches external event
    act(() => {
      window.dispatchEvent(
        new CustomEvent('omniterm:git-project-change', {
          detail: { path: 'C:/Projects/Repo1' },
        }),
      )
    })

    expect(result.current.activePath).toBe('C:/Projects/Repo1')
  })
})
