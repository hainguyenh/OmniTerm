/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionsPanelProps } from '../../../components/SessionsPanel'
import { useTabs } from '../../../ide/editor/core/controller'
import { initialTabsState } from '../../../ide/editor/core/model/tabs'
import { useWorkspaceStore } from '../../../platform/workspaceStore'
import { loadRecentLaunches, resetRecentLaunchesForTests } from '../../../utils/recentAgentLaunches'
import { applyPreset } from '../../layout/layoutPresets'
import { useProjectFilterStore } from '../../projectFilterStore'
import { useShellPanels } from '../../shellPanelsStore'
import { EmptyPaneLauncher } from '../EmptyPaneLauncher'

vi.mock('../../../features/agent-quota/agentQuotaAPI', () => ({ listAgentProfiles: () => Promise.resolve([]) }))

const workspaces = [
  {
    id: 'w1',
    name: 'Work',
    folders: [
      { id: 'f1', name: 'app', path: 'D:/app' },
      { id: 'f2', name: 'lib', path: 'D:/lib' },
    ],
  },
  { id: 'w2', name: 'Other', folders: [{ id: 'f3', name: 'site', path: 'D:/site' }] },
]

function publishSessions(onStart: SessionsPanelProps['onStart']) {
  // The launcher reads only the workspaces and the start callback of the Sessions panel's props.
  useShellPanels.setState({ sessions: { workspaces, onStart } as unknown as SessionsPanelProps })
}

/** Two panes, the first one active: the launcher belongs to the second. */
function twoPanes(): { active: string; empty: string } {
  act(() => useTabs.setState(applyPreset(useTabs.getState(), '2'), true))
  const active = useTabs.getState().activePane
  const empty = Object.keys(useTabs.getState().panes).find((id) => id !== active)!
  return { active, empty }
}

const sessionChoices = () => within(screen.getByRole('group', { name: 'Session' })).getAllByRole('button')

beforeEach(() => {
  useWorkspaceStore.setState({ selection: 'w1', scope: 'workspace' })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetRecentLaunchesForTests()
  useShellPanels.setState({ sessions: null })
  useProjectFilterStore.setState({ defaults: {} })
  useTabs.setState(initialTabsState(), true)
})

describe('EmptyPaneLauncher', () => {
  it('says the pane is empty until the Sessions panel publishes how to start one', () => {
    render(<EmptyPaneLauncher paneId="p" />)
    expect(screen.getByText('Empty pane')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Start a session in this pane' })).toBeNull()
  })

  it('offers the current workspace projects, the default project first chosen', () => {
    publishSessions(vi.fn())
    useProjectFilterStore.setState({ defaults: { w1: 'D:\\lib\\' } })
    render(<EmptyPaneLauncher paneId="p" />)
    const project = screen.getByRole('button', { name: 'Project' })
    expect(project.textContent).toContain('lib')
    expect(project.getAttribute('aria-haspopup')).toBe('listbox')
  })

  it('lists the terminal first as the default, then every agent with its brand icon', () => {
    publishSessions(vi.fn())
    render(<EmptyPaneLauncher paneId="p" />)
    const choices = sessionChoices()
    expect(choices.map((choice) => choice.getAttribute('aria-label'))).toEqual([
      'Terminal (default)', 'Claude', 'Codex', 'Antigravity', 'opencode',
    ])
    expect(choices.map((choice) => choice.querySelector('[data-icon]')?.getAttribute('data-icon'))).toEqual([
      'terminal',
      'agent-claude',
      'agent-codex',
      'agent-agy',
      'ext:omniterm/agent-opencode',
    ])
  })

  it('starts the chosen agent in the chosen project, in its own pane, and records the launch', () => {
    const onStart = vi.fn()
    publishSessions(onStart)
    const { active, empty } = twoPanes()
    render(<EmptyPaneLauncher paneId={empty} />)
    const project = screen.getByRole('button', { name: 'Project' })
    expect(project.textContent).toContain('app')
    // The dropdown is keyboard driven: open it, move to the next project, pick it.
    fireEvent.keyDown(project, { key: 'ArrowDown' })
    const listbox = document.querySelector('[data-autofocus]') as HTMLElement
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(project.textContent).toContain('lib')
    expect(useTabs.getState().activePane).toBe(active)
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/lib', label: 'lib' }), 'codex')
    expect(useTabs.getState().activePane).toBe(empty)
    expect(loadRecentLaunches()).toEqual([expect.objectContaining({ command: 'codex', cwd: 'D:/lib' })])
  })

  it('starts a plain terminal by default and moves between the choices with the arrow keys', () => {
    const onStart = vi.fn()
    publishSessions(onStart)
    render(<EmptyPaneLauncher paneId="p" />)
    const choices = sessionChoices()
    choices[0]!.focus()
    const group = screen.getByRole('group', { name: 'Session' })
    fireEvent.keyDown(group, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(choices[choices.length - 1])
    fireEvent.keyDown(group, { key: 'Home' })
    expect(document.activeElement).toBe(choices[0])
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(choices[1])
    fireEvent.click(choices[0]!)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/app' }), null)
    expect(loadRecentLaunches()).toEqual([])
  })
})
