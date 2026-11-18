/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executed: Array<{ action: string; arg?: unknown }> = []
vi.mock('../../ide/platform/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/platform/actions')>()
  return {
    ...actual,
    executeAction: vi.fn((action: string, arg?: unknown) => {
      executed.push({ action, arg })
      return Promise.resolve()
    }),
  }
})

import { runWidgetVisible, setRunHeaderAlways, useRunHeaderPref } from '../../ide/features/run/headerPref'
import { RunWidgetGate } from '../../ide/features/run/RunWidgetGate'
import { useRun, type RunSession } from '../../ide/features/run/store'
import { useDebugRunSessions } from '../../ide/workbench/contributions'
import { RunDockActions } from '../run/RunDockActions'
import { runDockState } from '../run/runDockState'

const session = (status: RunSession['status']): RunSession => ({ id: 's1', status, config: { id: 'c1', name: 'App' } } as unknown as RunSession)

beforeEach(() => {
  executed.length = 0
  localStorage.clear()
  act(() => {
    setRunHeaderAlways(false)
    useRun.setState({ configs: [], selectedId: null, sessions: [], activeSession: null })
    useDebugRunSessions.setState({ sessions: [] })
  })
})

describe('runWidgetVisible', () => {
  it('shows the title bar widget only while something runs, unless the user keeps it', () => {
    expect(runWidgetVisible(false, 0, 0)).toBe(false)
    expect(runWidgetVisible(false, 1, 0)).toBe(true)
    expect(runWidgetVisible(false, 0, 2)).toBe(true)
    expect(runWidgetVisible(true, 0, 0)).toBe(true)
  })

  it('remembers the choice', () => {
    setRunHeaderAlways(true)
    expect(localStorage.getItem('omniterm.run.headerAlways')).toBe('1')
    expect(useRunHeaderPref.getState().always).toBe(true)
  })
})

describe('RunWidgetGate', () => {
  it('draws nothing while idle, the widget while a run is live, and always when asked', () => {
    const { container } = render(<RunWidgetGate />)
    expect(container.querySelector('[data-run-chooser]')).toBeNull()
    act(() => useRun.setState({ sessions: [session('running')] }))
    expect(container.querySelector('[data-run-chooser]')).not.toBeNull()
    act(() => useRun.setState({ sessions: [session('exited' as RunSession['status'])] }))
    expect(container.querySelector('[data-run-chooser]')).toBeNull()
    act(() => setRunHeaderAlways(true))
    expect(container.querySelector('[data-run-chooser]')).not.toBeNull()
  })
})

describe('the Run tool window header', () => {
  it('derives its labels and which buttons apply', () => {
    expect(runDockState(undefined, 0, 0, 0)).toEqual({ configLabel: 'Add Configuration…', running: false, canRerun: false })
    expect(runDockState(' App ', 1, 0, 0)).toEqual({ configLabel: 'App', running: false, canRerun: true })
    expect(runDockState('App', 1, 1, 0).running).toBe(true)
    expect(runDockState('App', 0, 0, 1).running).toBe(true)
  })

  it('runs, debugs and opens the configuration chooser from the dock header', () => {
    render(<RunDockActions />)
    expect((screen.getByTestId('run-dock-stop') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('run-dock-rerun') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('run-dock-run'))
    fireEvent.click(screen.getByTestId('run-dock-debug'))
    fireEvent.click(screen.getByTestId('run-dock-config'))
    expect(executed.map((e) => e.action)).toEqual(['run.run', 'run.debug', 'run.chooseConfig'])
  })

  it('enables Stop and Rerun once a session runs', () => {
    act(() => useRun.setState({ sessions: [session('running')] }))
    render(<RunDockActions />)
    expect((screen.getByTestId('run-dock-stop') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('run-dock-stop'))
    expect(executed.at(-1)?.action).toBe('run.stop')
  })
})
