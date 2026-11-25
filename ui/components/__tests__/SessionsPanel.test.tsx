/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Connection, Workspace } from '../../domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearStoredSessions, loadStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { dockSession, resetTerminalDock } from '../../workbench/terminalDock/terminalDockStore'
import SessionsPanel, { type SessionsPanelChrome } from '../SessionsPanel'

const profilesMock = vi.fn()
vi.mock('../../features/agent-quota/agentQuotaAPI', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/agent-quota/agentQuotaAPI')>()),
  listAgentProfiles: () => profilesMock(),
}))
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
    profilesMock.mockReset()
    profilesMock.mockResolvedValue([])
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

  // Regression: a session running in the bottom Terminal tool window looked like any editor tab
  // session, so the list gave no hint of where it was.
  it('marks the sessions docked in the Terminal tool window', () => {
    setup()
    expect(screen.queryByTestId('session-docked-mark')).toBeNull()
    act(() => dockSession('t1'))
    expect(screen.getByTestId('session-docked-mark').closest('button')?.textContent).toContain('pwsh')
    act(() => resetTerminalDock())
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

  it('tints agent rows lightly only in the AI agents view', () => {
    act(() => setPanePresence({ t1: { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } }))
    const { view } = setup()
    expect(view.container.querySelector('[data-agent-highlight]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'AI agents' }))
    expect(view.container.querySelector('[data-agent-highlight]')).not.toBeNull()
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

  it('offers the Claude profiles found on this machine when Claude is hovered, and starts the chosen one', async () => {
    profilesMock.mockResolvedValue([
      { agent: 'claude', profileName: 'claude', profileDir: 'C:/u/.claude', launcher: null },
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' },
    ])
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    await waitFor(() => expect(profilesMock).toHaveBeenCalled())
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Claude' }).parentElement!)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'claude-work' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/work/app' }), 'claude-work')
  })

  it('starts plain claude, without a profile list, when only the default profile exists', async () => {
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    await waitFor(() => expect(profilesMock).toHaveBeenCalled())
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Claude' }).parentElement!)
    expect(screen.queryByRole('menu', { name: 'Claude profiles' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(onStart).toHaveBeenCalledWith(expect.anything(), 'claude')
  })

  it('opens a terminal in a project straight from its row', () => {
    const { onStart } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal in app' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/work/app' }), null)
  })

  it('says where an unfolded project without sessions is and starts one from it', () => {
    const onStart = vi.fn()
    const two = { id: 'w1', name: 'Work', folders: [{ path: 'D:/work/app' }, { path: 'D:/work/lib' }, { path: 'D:/work/off', disabled: true }] } as unknown as Workspace
    useWorkspaceStore.setState({ workspaces: [two], selection: 'w1', scope: 'workspace' })
    render(
      <SessionsPanel
        tabs={[{ id: 't1', connId: 'c1', name: 'pwsh' }]}
        workspaces={[two]}
        connById={(id) => (id === 'c1' ? local : undefined)}
        isEditor={() => false}
        sessionCwds={{}}
        activeTabId={null}
        onShowTab={vi.fn()}
        onStart={onStart}
        onResume={vi.fn()}
      />,
    )
    const empty = screen.getAllByTestId('session-group-empty')
    expect(empty).toHaveLength(1) // the disabled project is not listed empty
    expect(empty[0]!.textContent).toContain('No sessions · D:/work/lib')
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/work/lib' }), null)
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

  it('bookmarks a running agent from its row and shows it as bookmarked, then removes it', () => {
    useWorkspaceStore.setState({ workspaces: [workspace], selection: 'w1' })
    const sessionId = '33333333-3333-4333-8333-333333333333'
    setPanePresence({ t1: { agent: 'claude', profileName: 'claude', pid: 7, startTime: 7, agentSessionId: sessionId, claudeSessionId: sessionId } })
    upsertSession({ id: `claude:${sessionId}`, tabId: 't1', agent: 'claude', profileName: 'claude', sessionId, cwd: 'D:/work/app', state: 'active', updatedAt: Date.now() })
    setup()

    const button = screen.getByTestId('session-quick-bookmark')
    expect(button.getAttribute('data-state')).toBe('none')
    fireEvent.click(button)

    expect(screen.getByTestId('session-quick-bookmark').getAttribute('data-state')).toBe('bookmarked')
    expect(loadStoredSessions()[0]?.bookmarked).toBe(true)
    // Still the live row: no separate remembered row appears for it.
    expect(screen.queryByTestId('stored-session-row')).toBeNull()

    fireEvent.click(screen.getByTestId('session-quick-bookmark'))
    expect(screen.getByTestId('session-quick-bookmark').getAttribute('data-state')).toBe('none')
    expect(loadStoredSessions()[0]?.bookmarked).toBe(false)
  })

  it('offers no quick bookmark on a plain terminal row', () => {
    useWorkspaceStore.setState({ workspaces: [workspace], selection: 'w1' })
    setup()
    expect(screen.queryByTestId('session-quick-bookmark')).toBeNull()
  })
})

