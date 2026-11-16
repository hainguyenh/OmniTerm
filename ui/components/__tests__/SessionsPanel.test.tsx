/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Connection, Workspace } from '../../domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearStoredSessions, loadStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { resetPanePresenceForTests } from '../../utils/agentPresenceStore'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import SessionsPanel, { type SessionsPanelChrome } from '../SessionsPanel'

vi.mock('../BookmarksPanel', () => ({ default: () => <div data-testid="bookmarks-panel" /> }))

const local = { id: 'c1', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', localCwd: 'D:/work/app' } as Connection
const workspace = { id: 'w1', name: 'Work', folders: [{ path: 'D:/work/app' }] } as unknown as Workspace

function setup(activeTabId: string | null = 't1', chrome?: SessionsPanelChrome) {
  const onShowTab = vi.fn()
  const onStart = vi.fn()
  const onResume = vi.fn()
  const view = render(
    <SessionsPanel
      tabs={[{ id: 't1', connId: 'c1', name: 'pwsh' }, { id: 't2', connId: 'c1', name: 'notes.md' }]}
      workspaces={[workspace]}
      connById={(id) => (id === 'c1' ? local : undefined)}
      isEditor={(id) => id === 't2'}
      sessionCwds={{}}
      activeTabId={activeTabId}
      onShowTab={onShowTab}
      onStart={onStart}
      onResume={onResume}
      chrome={chrome}
    />,
  )
  return { onShowTab, onStart, onResume, view }
}

const interrupted = {
  id: 'claude:11111111-1111-4111-8111-111111111111',
  agent: 'claude' as const,
  profileName: 'claude',
  sessionId: '11111111-1111-4111-8111-111111111111',
  cwd: 'D:/work/app',
  title: 'Fix login',
  state: 'interrupted' as const,
  updatedAt: Date.now(),
}

describe('SessionsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStoredSessions()
    resetPanePresenceForTests()
    useWorkspaceStore.setState({ workspaces: [], selection: null, scope: 'workspace' })
  })

  it('shows the selected workspace by project, without a workspace row', () => {
    useWorkspaceStore.setState({ workspaces: [workspace], selection: 'w1' })
    setup()
    expect(screen.queryByTestId('session-section')).toBeNull()
    expect(screen.getByText('app')).toBeTruthy()
    expect(screen.getByText('pwsh')).toBeTruthy()
  })

  it('splits sessions per workspace when All workspaces is picked', () => {
    const other = { id: 'w2', name: 'Other', folders: [{ path: 'E:/other' }] } as unknown as Workspace
    useWorkspaceStore.setState({ workspaces: [workspace, other], selection: 'w2', scope: 'all' })
    setup()
    const sections = screen.getAllByTestId('session-section')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.textContent).toContain('Work')
    fireEvent.click(screen.getByRole('button', { name: /Work/ }))
    expect(screen.queryByText('pwsh')).toBeNull()
  })

  it('lists terminals under their project and leaves editor tabs out', () => {
    setup()
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('pwsh')).toBeTruthy()
    expect(screen.queryByText('notes.md')).toBeNull()
  })

  it('focuses a session and marks the active one', () => {
    const { onShowTab } = setup('t1')
    const row = screen.getByText('pwsh').closest('button') as HTMLButtonElement
    expect(row.getAttribute('aria-current')).toBe('true')
    fireEvent.click(row)
    expect(onShowTab).toHaveBeenCalledWith('t1')
  })

  it('filters to AI agents and shows the empty state', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'AI agents' }))
    expect(screen.getByText('No open sessions.')).toBeTruthy()
  })

  it('starts an agent in the chosen project from the quick start popup', () => {
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/work/app', workspaceId: 'w1' }), 'claude')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a plain terminal from the quick start popup', () => {
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(onStart).toHaveBeenCalledWith(expect.anything(), null)
  })

  it('shows an interrupted session with Resume and Discard, plus the Resume filter', () => {
    upsertSession(interrupted)
    const { onResume } = setup()
    expect(screen.getByText('Fix login')).toBeTruthy()
    expect(screen.getByText('interrupted')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Resume (1)' }))
    expect(screen.queryByText('pwsh')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Resume Fix login' }))
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: interrupted.id }), expect.stringContaining('claude'))

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Discard Fix login' })) })
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('offers a Bookmarks view only when bookmark props are given, and shows it in place of the list', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Bookmarks' })).toBeNull()
    cleanup()
    render(
      <SessionsPanel
        tabs={[{ id: 't1', connId: 'c1', name: 'pwsh' }]}
        workspaces={[workspace]}
        connById={() => local}
        isEditor={() => false}
        sessionCwds={{}}
        activeTabId="t1"
        onShowTab={vi.fn()}
        onStart={vi.fn()}
        onResume={vi.fn()}
        bookmarks={{ onLaunch: vi.fn(), onShowTab: vi.fn(), launchCommandFor: () => null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    expect(screen.getByTestId('bookmarks-panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.queryByTestId('bookmarks-panel')).toBeNull()
  })

  it('folds and unfolds a project group', () => {
    setup()
    const group = screen.getByRole('button', { name: /Work/ })
    expect(group.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('pwsh')).toBeNull()
    fireEvent.click(group)
    expect(screen.getByText('pwsh')).toBeTruthy()
  })

  it('leaves its header to the tool window and follows the given view state', () => {
    const chrome: SessionsPanelChrome = {
      quickStartOpen: false,
      setQuickStartOpen: vi.fn(),
      isCollapsed: (key) => key.length > 0,
      toggleGroup: vi.fn(),
    }
    const { view } = setup('t1', chrome)
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()
    expect(screen.queryByText('pwsh')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Work/ }))
    expect(chrome.toggleGroup).toHaveBeenCalledOnce()
    view.rerender(
      <SessionsPanel
        tabs={[{ id: 't1', connId: 'c1', name: 'pwsh' }]}
        workspaces={[workspace]}
        connById={() => local}
        isEditor={() => false}
        sessionCwds={{}}
        activeTabId="t1"
        onShowTab={vi.fn()}
        onStart={vi.fn()}
        onResume={vi.fn()}
        chrome={{ ...chrome, quickStartOpen: true, isCollapsed: () => false }}
      />,
    )
    expect(screen.getByText('pwsh')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Claude' })).toBeTruthy()
  })
})
