/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const executedActions: Array<{ action: string; arg?: unknown }> = []

vi.mock('../../ide/platform/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/platform/actions')>()
  return {
    ...actual,
    executeAction: vi.fn((action: string, arg?: unknown) => {
      executedActions.push({ action, arg })
      return Promise.resolve()
    }),
  }
})

import { RunWidget } from '../../ide/features/run/RunWidget'
import { CURRENT_FILE, useRun, type RunSession } from '../../ide/features/run/store'
import type { RunConfig } from '../../ide/platform/ipc'
import { hideContextMenu, useContextMenuStore } from '../../ide/ui'

describe('RunWidget (Feature 27)', () => {
  const sampleConfig: RunConfig = {
    id: 'cfg-1',
    name: 'Build & Test',
    kind: 'cargo',
    command: 'cargo',
    args: ['test'],
    cwd: null,
    env: {},
    detected: false,
    isTest: true,
    debugAdapter: 'lldb',
  }

  beforeEach(() => {
    executedActions.length = 0
    act(() => {
      useRun.setState({
        configs: [],
        selectedId: null,
        sessions: [],
        activeSession: null,
        chooserOpen: false,
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders default state with Select Configuration when no config is selected', async () => {
    render(<RunWidget />)

    expect(screen.getByText('Select Configuration')).toBeTruthy()
    const chooserBtn = screen.getByRole('button', { name: /Select Configuration/i })
    expect(chooserBtn).toBeTruthy()
    expect(chooserBtn.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      fireEvent.click(chooserBtn)
    })
    expect(executedActions).toContainEqual({
      action: 'run.chooseConfig',
      arg: 'select',
    })
  })

  it('renders selected config name and executes run when Run button is clicked', async () => {
    act(() => {
      useRun.setState({
        configs: [sampleConfig],
        selectedId: sampleConfig.id,
      })
    })

    render(<RunWidget />)

    expect(screen.getByText('Build & Test')).toBeTruthy()

    const runBtn = screen.getByRole('button', { name: "Run 'Build & Test'" })
    expect(runBtn).toBeTruthy()
    expect(runBtn.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      fireEvent.click(runBtn)
    })
    expect(executedActions).toContainEqual({
      action: 'run.run',
      arg: undefined,
    })
  })

  it('renders selected config and executes debug when Debug button is clicked', async () => {
    act(() => {
      useRun.setState({
        configs: [sampleConfig],
        selectedId: sampleConfig.id,
      })
    })

    render(<RunWidget />)

    const debugBtn = screen.getByRole('button', { name: "Debug 'Build & Test'" })
    expect(debugBtn).toBeTruthy()
    expect(debugBtn.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      fireEvent.click(debugBtn)
    })
    expect(executedActions).toContainEqual({
      action: 'run.debug',
      arg: undefined,
    })
  })

  it('displays Current File mode when selectedId is CURRENT_FILE', async () => {
    act(() => {
      useRun.setState({
        configs: [sampleConfig],
        selectedId: CURRENT_FILE,
      })
    })

    render(<RunWidget />)

    expect(screen.getByText('Current File')).toBeTruthy()

    const runBtn = screen.getByRole('button', { name: 'Run Current File' })
    expect(runBtn).toBeTruthy()
    expect(runBtn.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      fireEvent.click(runBtn)
    })
    expect(executedActions).toContainEqual({
      action: 'run.run',
      arg: undefined,
    })
  })

  it('renders active running indicator, rerun button, and stop button when session is live', async () => {
    const liveSession: RunSession = {
      id: 'session-1',
      runId: 101,
      config: sampleConfig,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      stdinClosed: false,
      exitCode: null,
      stopped: false,
    }

    act(() => {
      useRun.setState({
        configs: [sampleConfig],
        selectedId: sampleConfig.id,
        sessions: [liveSession],
        activeSession: liveSession.id,
      })
    })

    render(<RunWidget />)

    // In live session, status dot is rendered
    expect(screen.getByLabelText('Running')).toBeTruthy()

    // Rerun button is rendered
    const rerunBtn = screen.getByRole('button', { name: /Rerun 'Build & Test'/i })
    expect(rerunBtn).toBeTruthy()

    // Stop button is rendered
    const stopBtn = screen.getByRole('button', { name: /Stop 'Build & Test'/i })
    expect(stopBtn).toBeTruthy()

    await act(async () => {
      fireEvent.click(stopBtn)
    })
    expect(executedActions).toContainEqual({
      action: 'run.stop',
      arg: 'widget',
    })
  })

  it('has no visible More Actions button; the widget context menu carries the extra actions', async () => {
    act(() => {
      useRun.setState({
        configs: [sampleConfig],
        selectedId: sampleConfig.id,
      })
    })

    const { container } = render(<RunWidget />)

    expect(screen.queryByRole('button', { name: 'More Actions' })).toBeNull()
    expect(useContextMenuStore.getState().menu).toBeNull()

    await act(async () => {
      fireEvent.contextMenu(container.firstElementChild!)
    })
    const menu = useContextMenuStore.getState().menu
    expect(menu).not.toBeNull()
    const actions = menu!.items.flatMap((item) => (item.kind === 'action' ? [item.action] : []))
    expect(actions).toEqual(expect.arrayContaining(['run.runContext', 'run.debugContext', 'run.editConfigs', 'run.reloadConfigs']))
    act(() => hideContextMenu())
  })
})
