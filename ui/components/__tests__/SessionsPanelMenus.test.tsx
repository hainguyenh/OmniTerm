/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Connection, Workspace } from '../../domain'

const menu = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('../../ide/ui/Menu', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showContextMenu: menu.show,
}))
vi.mock('../BookmarksPanel', () => ({ default: () => null }))

import { registerQuotaCommands, resetQuotaStore, updateQuota } from '../../features/agent-quota/quotaStore'
import type { MenuItem } from '../../ide/ui/Menu'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { clearStoredSessions } from '../../utils/agentSessionStorage'
import { sessionRowLabel } from '../../utils/sessionRowLabel'
import { resetSessionBridge, useSessionBridge } from '../../workbench/sessions/sessionBridge'
import SessionsPanel from '../SessionsPanel'

const local = { id: 'c1', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', localCwd: 'D:/work/app' } as Connection
const workspace = { id: 'w1', name: 'Work', folders: [{ path: 'D:/work/app' }] } as unknown as Workspace

function setup() {
  const onStart = vi.fn()
  const onShowTab = vi.fn()
  render(
    <SessionsPanel
      tabs={[{ id: 't1', connId: 'c1', name: 'pwsh' }]}
      workspaces={[workspace]}
      connById={(id) => (id === 'c1' ? local : undefined)}
      isEditor={() => false}
      sessionCwds={{}}
      activeTabId={null}
      onShowTab={onShowTab}
      onStart={onStart}
      onResume={vi.fn()}
    />,
  )
  return { onStart, onShowTab }
}

const lastMenu = () => menu.show.mock.calls.at(-1)![1] as MenuItem[]
const labels = (items: MenuItem[]) => items.map((item) => ('label' in item ? item.label : item.kind))
const run = (items: MenuItem[], label: string) => {
  const item = items.find((entry) => 'label' in entry && entry.label === label) as { run: () => void }
  item.run()
}

beforeEach(() => {
  localStorage.clear()
  clearStoredSessions()
  resetPanePresenceForTests()
  resetQuotaStore()
  menu.show.mockClear()
  useWorkspaceStore.setState({ workspaces: [workspace], selection: 'w1', scope: 'workspace' })
  useSessionBridge.setState({
    sessions: [{ id: 't1', connId: 'c1', name: 'pwsh', connType: 'LOCAL', workspaceId: 'w1', status: 'connected', busy: false, cwd: 'D:/work/app', hasCommand: false }],
  })
})
afterEach(() => {
  cleanup()
  resetSessionBridge()
})

describe('Sessions panel labels', () => {
  it('reads profile – conversation title for an agent, the name for a terminal', () => {
    expect(sessionRowLabel('pwsh', null, null)).toBe('pwsh')
    expect(sessionRowLabel('pwsh', 'claude-work', null)).toBe('claude-work \u2013 pwsh')
    expect(sessionRowLabel('pwsh', 'claude-work', 'Fix the login bug')).toBe('claude-work \u2013 Fix the login bug')
    expect(sessionRowLabel('claude-work', 'claude-work', null)).toBe('claude-work')
  })

  // Regression: an agent's row showed the terminal's name ("pwsh") instead of its profile.
  it('names an agent row after its profile', () => {
    setPanePresence({ t1: { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 0 } })
    setup()
    expect(screen.getByText('claude-work \u2013 pwsh')).toBeTruthy()
  })
})

describe('Sessions panel menus', () => {
  // Regression: a project row had no way to start a terminal or an agent in its folder.
  it('starts a terminal or an agent from a project row', () => {
    const { onStart } = setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: /^app/, expanded: true }))
    expect(labels(lastMenu())).toContain('New Terminal')
    run(lastMenu(), 'New Claude Session')
    expect(onStart).toHaveBeenCalledWith({ key: 'dir:d:/work/app', label: 'app', cwd: 'D:/work/app', workspaceId: 'w1' }, 'claude')
    fireEvent.click(screen.getByRole('button', { name: 'New session in app' }))
    run(lastMenu(), 'New Terminal')
    expect(onStart).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: 'D:/work/app' }), null)
  })

  // Regression: a session row had no context menu: no bookmark, kill or suspend.
  it('offers show, suspend (through the quota monitor) and kill on a session row', () => {
    const suspend = vi.fn()
    const stop = registerQuotaCommands({ suspend })
    setPanePresence({ t1: { agent: 'claude', profileName: 'claude', pid: 1, startTime: 0 } })
    act(() => {
      updateQuota((state) => ({
        ...state,
        terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir: null, profileName: 'claude', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'claude:default' } },
      }))
    })
    const { onShowTab } = setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: /claude/ }))
    const items = lastMenu()
    expect(labels(items)).toEqual(expect.arrayContaining(['Show', 'Suspend Agent', 'Bookmark Agent Session', 'Kill Session']))
    run(items, 'Suspend Agent')
    expect(suspend).toHaveBeenCalledWith('t1')
    run(items, 'Show')
    expect(onShowTab).toHaveBeenCalledWith('t1')
    stop()
  })
})
