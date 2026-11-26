/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryBackend } from '../../ide/editor/core/backend'
import { EditorController, useTabs } from '../../ide/editor/core/controller'
import { initialTabsState } from '../../ide/editor/core/model/tabs'
import { registerAction } from '../../ide/platform/actions'
import { EditorAreaView } from '../../ide/editor/core/view/EditorArea'
import { registerEditorKind } from '../../ide/workbench/contributions'
import { omnitermActionId } from '../../platform/omnitermActions'
import type { SessionsPanelProps } from '../../components/SessionsPanel'
import { applyPreset } from '../layout/layoutPresets'
import { registerPaneTitleActions } from '../layout/paneTitleActions'
import { usePaneQuickStart } from '../sessions/paneQuickStartStore'
import { useShellPanels } from '../shellPanelsStore'

vi.mock('../../features/agent-quota/agentQuotaAPI', () => ({ listAgentProfiles: () => Promise.resolve([]) }))

const workspace = { id: 'w1', name: 'Work', folders: [{ id: 'f1', name: 'app', path: 'D:/app' }] }

const holder = vi.hoisted(() => ({ controller: null as unknown }))
vi.mock('../../ide/editor/core/controller', async (original) => ({
  ...(await original<object>()),
  editorController: () => holder.controller,
}))

let controller: EditorController
const disposers: Array<() => void> = []

beforeEach(() => {
  // jsdom has no ResizeObserver; the split layout of two panes measures itself with one.
  globalThis.ResizeObserver ??= class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  controller = new EditorController(createMemoryBackend({}))
  holder.controller = controller
  controller.start()
  disposers.push(
    registerEditorKind({ kind: 'test-doc', title: () => 'Doc', component: () => <div data-testid="doc" /> }),
    registerPaneTitleActions(),
    registerAction({ id: omnitermActionId('newSession'), title: 'New Session', run: vi.fn() }),
  )
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach((dispose) => dispose())
  controller.stop()
  useTabs.setState(initialTabsState(), true)
  usePaneQuickStart.setState({ target: null })
  useShellPanels.setState({ sessions: null })
  localStorage.clear()
})

describe('pane actions', () => {
  it('keep tab and pane actions in the strip and float the editor actions over the content', async () => {
    await act(() => controller.openInput({ kind: 'test-doc', key: 'test-doc:1' }))
    render(<EditorAreaView />)
    const maximize = screen.getByRole('button', { name: 'Maximize this pane' })
    const newSession = screen.getByRole('button', { name: 'New terminal or agent session in this pane' })
    const split = screen.getByRole('button', { name: 'Split Right' })
    const more = screen.getByRole('button', { name: 'Tab Actions' })
    const content = screen.getByTestId('doc').closest('[role="tabpanel"]')
    const strip = screen.getByRole('tablist').parentElement
    // The strip ends with what acts on tabs and the pane: Tab Actions, then the new session.
    for (const button of [more, newSession]) {
      expect(button.closest('[role="tablist"]')).toBeNull()
      expect(strip?.contains(button)).toBe(true)
    }
    expect(more.compareDocumentPosition(newSession) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The editor's actions float at its top-right corner, as one toolbar.
    const editorActions = screen.getByRole('toolbar', { name: 'Editor actions' })
    for (const button of [split, maximize]) {
      expect(content?.contains(button)).toBe(true)
      expect(editorActions.contains(button)).toBe(true)
    }
  })

  it('drop the tab and editor actions when no tab is open', async () => {
    await act(() => controller.openInput({ kind: 'test-doc', key: 'test-doc:1' }))
    render(<EditorAreaView />)
    expect(screen.getByRole('button', { name: 'Split Right' })).toBeTruthy()
    await act(() => controller.closeEverything())
    expect(screen.queryByRole('button', { name: 'Split Right' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tab Actions' })).toBeNull()
  })

  it('make their own pane the active one when pressed, and an empty pane starts a session in itself', async () => {
    const onStart = vi.fn()
    // The launcher reads only the workspaces and the start callback of the Sessions panel's props.
    useShellPanels.setState({ sessions: { workspaces: [workspace], onStart } as unknown as SessionsPanelProps })
    await act(() => controller.openInput({ kind: 'test-doc', key: 'test-doc:1' }))
    const first = useTabs.getState().activePane
    act(() => useTabs.setState(applyPreset(useTabs.getState(), '2'), true))
    render(<EditorAreaView />)
    const launcher = screen.getByRole('region', { name: 'Start a session in this pane' })
    const empty = launcher.closest('[data-pane-id]') as HTMLElement
    expect(empty.dataset.paneId).not.toBe(first)
    expect(screen.getByText('Drop a tab here to move it into this pane')).toBeTruthy()
    act(() => useTabs.setState((state) => ({ ...state, activePane: first }), true))
    const plus = empty.querySelector('button[aria-label="New terminal or agent session in this pane"], button[title="New terminal or agent session in this pane"]') as HTMLElement
    fireEvent.pointerDown(plus)
    expect(useTabs.getState().activePane).toBe(empty.dataset.paneId)
    // The launcher starts the default terminal in this pane's project, right away.
    act(() => useTabs.setState((state) => ({ ...state, activePane: first }), true))
    const terminal = screen.getByRole('button', { name: 'Terminal (default)' })
    fireEvent.pointerDown(terminal)
    fireEvent.click(terminal)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:/app' }), null)
    expect(useTabs.getState().activePane).toBe(empty.dataset.paneId)
  })
})
