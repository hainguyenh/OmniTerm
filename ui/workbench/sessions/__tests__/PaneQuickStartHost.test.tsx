/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionsPanelProps } from '../../../components/SessionsPanel'
import { useTabs } from '../../../ide/editor/core/controller'
import { initialTabsState } from '../../../ide/editor/core/model/tabs'
import { recordAgentLaunch, resetRecentLaunchesForTests } from '../../../utils/recentAgentLaunches'
import { applyPreset } from '../../layout/layoutPresets'
import { useShellPanels } from '../../shellPanelsStore'
import { PaneQuickStartHost } from '../PaneQuickStartHost'
import { openPaneQuickStart, usePaneQuickStart } from '../paneQuickStartStore'

vi.mock('../../../features/agent-quota/agentQuotaAPI', () => ({ listAgentProfiles: () => Promise.resolve([]) }))

const workspace = {
  id: 'w1',
  name: 'Work',
  folders: [{ id: 'f1', name: 'app', path: 'D:/app' }],
}

function publishSessions(onStart: SessionsPanelProps['onStart']) {
  // The host reads only the workspaces and the start callback of the Sessions panel's props.
  useShellPanels.setState({ sessions: { workspaces: [workspace], onStart } as unknown as SessionsPanelProps })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetRecentLaunchesForTests()
  usePaneQuickStart.setState({ target: null })
  useShellPanels.setState({ sessions: null })
  useTabs.setState(initialTabsState(), true)
})

describe('PaneQuickStartHost', () => {
  it('shows nothing until an empty pane asks for the picker', () => {
    publishSessions(vi.fn())
    render(<PaneQuickStartHost />)
    expect(screen.queryByRole('dialog', { name: 'Start a session' })).toBeNull()
  })

  it('starts the chosen agent in the pane that opened the picker, then closes', () => {
    const onStart = vi.fn()
    publishSessions(onStart)
    act(() => useTabs.setState(applyPreset(useTabs.getState(), '2'), true))
    const panes = Object.keys(useTabs.getState().panes)
    const target = panes.find((id) => id !== useTabs.getState().activePane) ?? panes[0]!
    act(() => useTabs.setState((state) => ({ ...state, activePane: target }), true))
    render(<PaneQuickStartHost />)
    act(() => openPaneQuickStart())
    expect(usePaneQuickStart.getState().target?.paneId).toBe(target)
    // The user clicked into the other pane while the picker was open.
    const other = panes.find((id) => id !== target)!
    act(() => useTabs.setState((state) => ({ ...state, activePane: other }), true))
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/app' }), 'codex')
    expect(useTabs.getState().activePane).toBe(target)
    expect(screen.queryByRole('dialog', { name: 'Start a session' })).toBeNull()
  })

  it('offers the recent agent and project pairs that are still projects, and records a start', () => {
    const onStart = vi.fn()
    publishSessions(onStart)
    recordAgentLaunch('claude-work', 'D:/app/', 2)
    recordAgentLaunch('codex', 'D:/gone', 3)
    render(<PaneQuickStartHost />)
    act(() => openPaneQuickStart())
    expect(screen.queryByRole('button', { name: 'Start codex in gone' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start claude-work in app' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/app' }), 'claude-work')
    act(() => openPaneQuickStart())
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    act(() => openPaneQuickStart())
    const recent = screen.getAllByRole('button', { name: /^Start / }).map((button) => button.getAttribute('aria-label'))
    expect(recent).toEqual(['Start codex in app', 'Start claude-work in app'])
  })
})
