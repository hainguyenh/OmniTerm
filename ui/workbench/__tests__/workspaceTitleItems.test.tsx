/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Workspace } from '../../domain'

vi.mock('../../ide/features/welcome/RecentList', () => ({ ProjectBadge: ({ name }: { name: string }) => <i>{name[0]}</i> }))
vi.mock('../../ide/workbench/inputDialogs', () => ({ promptInput: vi.fn().mockResolvedValue('New one') }))

import { useWorkspaceStore } from '../../platform/workspaceStore'
import { useProjectFilterStore } from '../projectFilterStore'
import { ProjectFilterItem } from '../titlebar/ProjectFilterItem'
import { WorkspacePopup } from '../titlebar/WorkspacePopup'

const ws = (id: string, folders: Array<[string, string]>): Workspace => ({
  id,
  name: `ws-${id}`,
  order: 0,
  pins: [],
  folders: folders.map(([name, path]) => ({ id: name, name, path })) as Workspace['folders'],
})
const catalog = [ws('a', [['OmniTerm', 'D:/w/OmniTerm'], ['docs', 'D:/w/docs']]), ws('b', [['solo', 'D:/w/solo']])]

describe('workspace title items', () => {
  const create = vi.fn().mockResolvedValue({ id: 'c' })
  beforeEach(() => {
    localStorage.clear()
    useProjectFilterStore.getState().reset()
    useWorkspaceStore.setState({ workspaces: catalog, loaded: true, selection: 'a::OmniTerm', scope: 'workspace' })
    create.mockClear()
    window.omnitermAPI = {
      ...window.omnitermAPI,
      workspace: {
        list: vi.fn().mockResolvedValue(catalog),
        loadConnections: vi.fn().mockImplementation(async (id: string) => (id === 'a' ? [{}, {}] : [])),
        create,
        add: vi.fn(),
        addFolder: vi.fn(),
        importFile: vi.fn(),
      } as never,
    }
  })

  it('the workspace popup lists workspaces with counts and switches the shared selection', async () => {
    const onClose = vi.fn()
    render(<WorkspacePopup anchor={createRef()} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('2 projects · 2 connections')).toBeTruthy())
    expect(screen.getByText('1 project · 0 connections')).toBeTruthy()
    fireEvent.click(screen.getByText('ws-b'))
    expect(useWorkspaceStore.getState().selection).toBe('b::solo')
    expect(onClose).toHaveBeenCalled()
  })

  it('the workspace popup picks All workspaces, and a workspace row scopes back to that workspace', async () => {
    render(<WorkspacePopup anchor={createRef()} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('All workspaces'))
    expect(useWorkspaceStore.getState()).toMatchObject({ scope: 'all', selection: 'a::OmniTerm' })
    fireEvent.click(screen.getByText('ws-b'))
    expect(useWorkspaceStore.getState()).toMatchObject({ scope: 'workspace', selection: 'b::solo' })
  })

  it('the workspace popup offers All workspaces only with several workspaces', () => {
    useWorkspaceStore.setState({ workspaces: [catalog[0] as Workspace] })
    render(<WorkspacePopup anchor={createRef()} onClose={() => {}} />)
    expect(screen.queryByText('All workspaces')).toBeNull()
  })

  it('the workspace popup creates a workspace by name', async () => {
    render(<WorkspacePopup anchor={createRef()} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('New workspace…'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('New one'))
  })

  it('the filter shows All projects with a count and filters to one folder', () => {
    render(<ProjectFilterItem />)
    expect(screen.getByText('All projects')).toBeTruthy()
    fireEvent.click(screen.getByTestId('project-filter'))
    fireEvent.click(screen.getByText('docs'))
    expect(useProjectFilterStore.getState().filter).toBe('D:/w/docs')
    expect(screen.getByTestId('project-filter').textContent).toContain('docs')
  })

  it('the filter goes back to all projects when the workspace changes and hides without folders', () => {
    render(<ProjectFilterItem />)
    useProjectFilterStore.getState().setFilter('D:/w/docs')
    useWorkspaceStore.getState().selectWorkspace('b')
    expect(useProjectFilterStore.getState().filter).toBe('all')
    act(() => useWorkspaceStore.setState({ workspaces: [ws('a', [])], selection: 'a' }))
    expect(screen.queryByTestId('project-filter')).toBeNull()
  })
})
