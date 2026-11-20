/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/features/debugger/ui/DebugToolWindow', () => ({
  DebugToolWindow: () => <div data-testid="upstream-debug-tool-window">Upstream Debug View</div>,
  DebugTabs: () => <div data-testid="upstream-debug-tabs">Upstream Debug Tabs</div>,
}))

import { useDebug, type DebugSession } from '../../ide/features/debugger/state'
import { executeAction, registerActions } from '../../ide/platform/actions'
import { DebuggerTabs, DebuggerToolWindow } from '../debugger/DebuggerToolWindow'
import { registerDebuggerWorkbench } from '../debugger/registerDebuggerWorkbench'

describe('DebuggerToolWindow (Features 32 & 34)', () => {
  const executedActions: string[] = []
  let unregisterBaseActions: (() => void) | null = null

  beforeEach(() => {
    executedActions.length = 0
    unregisterBaseActions = registerActions([
      { id: 'run.debug', title: 'Debug', run: () => { executedActions.push('run.debug') } },
      { id: 'debug.viewBreakpoints', title: 'View Breakpoints', run: () => { executedActions.push('debug.viewBreakpoints') } },
      { id: 'debug.stepOver', title: 'Step Over', run: () => { executedActions.push('debug.stepOver') } },
      { id: 'debug.stepInto', title: 'Step Into', run: () => { executedActions.push('debug.stepInto') } },
      { id: 'debug.stepOut', title: 'Step Out', run: () => { executedActions.push('debug.stepOut') } },
      { id: 'debug.resume', title: 'Resume', run: () => { executedActions.push('debug.resume') } },
      { id: 'debug.pause', title: 'Pause', run: () => { executedActions.push('debug.pause') } },
      { id: 'debug.stop', title: 'Stop', run: () => { executedActions.push('debug.stop') } },
    ])

    act(() => {
      useDebug.setState({
        sessions: {},
        active: null,
      })
    })
  })

  afterEach(() => {
    unregisterBaseActions?.()
    vi.clearAllMocks()
  })

  it('renders OmniTerm empty state when no debug session is active', () => {
    render(<DebuggerToolWindow />)

    expect(screen.getByTestId('debugger-empty-state')).toBeTruthy()
    expect(screen.getByText('Debugger')).toBeTruthy()
    expect(
      screen.getByText('Debugger: Inspect call stacks, threads, variables, and watch expressions'),
    ).toBeTruthy()

    const startBtn = screen.getByRole('button', { name: /Start Debugging/i })
    fireEvent.click(startBtn)
    expect(executedActions).toContain('run.debug')

    const bpBtn = screen.getByRole('button', { name: /View Breakpoints…/i })
    fireEvent.click(bpBtn)
    expect(executedActions).toContain('debug.viewBreakpoints')
  })

  it('renders active debug session view when a session is active', () => {
    const dummySession = {
      id: 10,
      name: 'debug-target',
      adapter: 'lldb',
      status: 'paused',
      startedAt: Date.now(),
      threads: [{ id: 1, name: 'Main Thread' }],
      frames: [
        {
          id: 101,
          name: 'main',
          line: 42,
          column: 1,
          path: 'src/main.rs',
          presentationHint: null,
        },
      ],
      selectedThread: 1,
      selectedFrame: 101,
      scopes: {},
      variables: {},
      capabilities: {},
      output: [],
    } as unknown as DebugSession

    act(() => {
      useDebug.setState({
        sessions: { 10: dummySession },
        active: 10,
      })
    })

    render(<DebuggerToolWindow />)

    expect(screen.queryByTestId('debugger-empty-state')).toBeNull()
    expect(screen.getByTestId('debugger-tool-window')).toBeTruthy()
    expect(screen.getByTestId('upstream-debug-tool-window')).toBeTruthy()
  })

  it('renders DebuggerTabs header component', () => {
    render(<DebuggerTabs />)
    expect(screen.getByTestId('upstream-debug-tabs')).toBeTruthy()
  })

  describe('registerDebuggerWorkbench & Stepping Actions (Feature 34)', () => {
    it('registers stepping, pause, resume, and stop actions', async () => {
      const dispose = registerDebuggerWorkbench()
      expect(dispose).toBeTypeOf('function')

      // Verify delegation of workbench actions to underlying debugger commands
      await executeAction('workbench.debug.stepOver')
      expect(executedActions).toContain('debug.stepOver')

      await executeAction('workbench.debug.stepInto')
      expect(executedActions).toContain('debug.stepInto')

      await executeAction('workbench.debug.stepOut')
      expect(executedActions).toContain('debug.stepOut')

      await executeAction('workbench.debug.resume')
      expect(executedActions).toContain('debug.resume')

      await executeAction('workbench.debug.pause')
      expect(executedActions).toContain('debug.pause')

      await executeAction('workbench.debug.stop')
      expect(executedActions).toContain('debug.stop')

      dispose()
    })
  })
})
