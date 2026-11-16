/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const panel = vi.hoisted(() => ({ chrome: null as null | { quickStartOpen: boolean; isCollapsed: (key: string) => boolean; toggleGroup: (key: string) => void } }))
const registered = vi.hoisted(() => ({
  items: [] as Array<{ id: string; anchor: string; icon: string; order?: number; requiresProject?: boolean; component: () => unknown }>,
}))

vi.mock('../../ide/workbench/contributions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/workbench/contributions')>()
  return {
    ...actual,
    registerToolWindow: vi.fn((item: (typeof registered.items)[number]) => {
      registered.items.push(item)
      return () => {}
    }),
  }
})
vi.mock('../../ide/features/project-tree/ProjectView', () => ({
  ProjectView: () => <div data-testid="project-view" />,
}))
vi.mock('../../ide/features/project-tree/HeaderActions', () => ({
  ProjectHeaderActions: () => null,
  useProjectHeaderMenu: () => [],
  useProjectTitleMenu: () => ({ label: 'Project', items: [] }),
}))
vi.mock('../../components/SessionsPanel', () => ({
  default: ({ bookmarks, chrome }: { bookmarks?: unknown; chrome?: typeof panel.chrome }) => {
    panel.chrome = chrome ?? null
    return <div data-testid="sessions-panel" data-bookmarks={bookmarks ? 'yes' : 'no'} />
  },
}))

import { hasStripeButton } from '../../ide/workbench/toolwindows/store'
import { registerShellToolWindows } from '../registerShellToolWindows'
import { useShellPanels } from '../shellPanelsStore'
import { SessionsHeaderActions, SessionsToolWindow } from '../ShellToolWindows'
import { isGroupCollapsed, useSessionsView } from '../sessionsViewStore'
import { useSessionCleanup } from '../sessions/sessionCleanupStore'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { encodeWorkspaceSelection } from '../../utils/workspaceSelection'
import { StripePortal } from '../StripePortal'

describe('shell tool windows', () => {
  beforeEach(() => {
    registered.items = []
    act(() => useShellPanels.setState({ sessions: null, bookmarks: null }))
    act(() => useSessionsView.setState({ quickStartOpen: false, allCollapsed: false, collapsed: {} }))
    document.body.innerHTML = ''
  })

  it('registers Project, Sessions and Problems; bookmarks are not a second stripe button', () => {
    registerShellToolWindows()
    expect(registered.items.map((i) => i.id)).toEqual([
      'project',
      'omniterm.sessions',
      'problems',
    ])
    const leftWindows = registered.items.filter((i) => i.anchor === 'left')
    expect(leftWindows.map((i) => i.id)).toEqual(['project', 'omniterm.sessions'])
    expect(leftWindows.every((i) => i.requiresProject === false)).toBe(true)
    expect(leftWindows[0]?.order).toBe(0)

    const problemsWindow = registered.items.find((i) => i.id === 'problems')
    expect(problemsWindow).toBeDefined()
    expect(problemsWindow?.anchor).toBe('bottom')
    expect(problemsWindow?.order).toBe(30)
    expect(problemsWindow?.requiresProject).toBe(false)
  })

  it('gives only the windows of the mock a stripe button by default, and the user choice still wins', () => {
    const off = registerShellToolWindows()
    const tw = (id: string, stripe?: 'onUse') => ({ id, stripe }) as never
    for (const id of ['project', 'commit', 'bookmarks', 'omniterm.sessions', 'omniterm.terminal', 'run', 'debug', 'git', 'problems', 'notifications']) {
      expect(hasStripeButton(tw(id), {}), id).toBe(true)
    }
    for (const id of ['structure', 'todo', 'find', 'database', 'agents', 'inspection', 'connections']) {
      expect(hasStripeButton(tw(id), {}), id).toBe(false)
    }
    expect(hasStripeButton(tw('structure'), { structure: true })).toBe(true)
    expect(hasStripeButton(tw('project'), { project: false })).toBe(false)
    off()
    expect(hasStripeButton(tw('structure'), {})).toBe(true)
  })

  it('shows nothing until the shell publishes the panel props', () => {
    const view = render(<SessionsToolWindow />)
    expect(screen.queryByTestId('sessions-panel')).toBeNull()
    act(() => useShellPanels.setState({ sessions: {} as never }))
    view.rerender(<SessionsToolWindow />)
    expect(screen.getByTestId('sessions-panel')).toBeTruthy()
    expect(screen.getByTestId('sessions-panel').dataset.bookmarks).toBe('no')
    act(() => useShellPanels.setState({ bookmarks: {} as never }))
    expect(screen.getByTestId('sessions-panel').dataset.bookmarks).toBe('yes')
  })

  it('gives every stripe button its own icon, none of them upstream Bookmarks or Agents icon', () => {
    registerShellToolWindows()
    const icons = registered.items.map((i) => i.icon)
    expect(new Set(icons).size).toBe(icons.length)
    expect(icons).not.toContain('toolwindow-bookmarks')
    expect(icons).not.toContain('toolwindow-agents')
  })

  it('renders into the bottom of the stripe', () => {
    document.body.innerHTML = '<nav data-stripe-side="right"><button>tw</button></nav>'
    render(<StripePortal side="right"><span data-testid="layout" /></StripePortal>, { container: document.body.appendChild(document.createElement('div')) })
    const stripe = document.querySelector('[data-stripe-side="right"]')!
    expect(stripe.lastElementChild?.getAttribute('data-stripe-bottom')).toBe('right')
    expect(stripe.querySelector('[data-testid="layout"]')).not.toBeNull()
  })

  it('gives the Sessions window header the workspace name, New Session and Collapse All', () => {
    act(() => useWorkspaceStore.setState({ workspaces: [{ id: 'w1', name: 'Work', folders: [] } as never], selection: encodeWorkspaceSelection('w1') }))
    act(() => useShellPanels.setState({ sessions: {} as never }))
    render(<><SessionsHeaderActions /><SessionsToolWindow /></>)
    expect(screen.getByTestId('sessions-workspace-label').textContent).toBe('Work')
    const add = screen.getByRole('button', { name: 'New Session…' })
    fireEvent.click(add)
    expect(useSessionsView.getState().quickStartOpen).toBe(true)
    expect(panel.chrome?.quickStartOpen).toBe(true)
    expect(add.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('sessions-cleanup-button'))
    expect(useSessionCleanup.getState().open).toBe(true)
    act(() => useSessionCleanup.getState().setOpen(false))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }))
    expect(panel.chrome?.isCollapsed('w1')).toBe(true)
    act(() => panel.chrome?.toggleGroup('w1'))
    expect(panel.chrome?.isCollapsed('w1')).toBe(false)
    expect(panel.chrome?.isCollapsed('w2')).toBe(true)
  })

  it('folds groups on their own until Collapse All folds every one', () => {
    const view = useSessionsView.getState()
    view.toggleGroup('a')
    expect(isGroupCollapsed(useSessionsView.getState(), 'a')).toBe(true)
    expect(isGroupCollapsed(useSessionsView.getState(), 'b')).toBe(false)
    view.collapseAll()
    expect(useSessionsView.getState().collapsed).toEqual({})
    expect(isGroupCollapsed(useSessionsView.getState(), 'b')).toBe(true)
  })
})
