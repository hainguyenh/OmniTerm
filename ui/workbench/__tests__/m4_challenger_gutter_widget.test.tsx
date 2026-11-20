/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'

const mockExecuteAction = vi.fn((_action: string, _arg?: unknown) => Promise.resolve())

vi.mock('../../ide/platform/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/platform/actions')>()
  return {
    ...actual,
    executeAction: (...args: [string, unknown?]) => mockExecuteAction(...args),
  }
})

vi.mock('../../ide/platform/ipc', () => ({
  call: vi.fn(() => Promise.resolve([])),
  commands: {
    debugSetBreakpoints: vi.fn(() => Promise.resolve([])),
    debugBreakpointStates: vi.fn(() => Promise.resolve([])),
  },
  isTauri: vi.fn(() => false),
}))

import {
  interpolateLog,
  mapLines,
  toBackend,
  toggleLine,
  type BreakpointEntry,
} from '../../ide/features/debugger/breakpoints/model'
import {
  addBreakpoint,
  breakpointsOf,
  flushBreakpoints,
  removeAllBreakpoints,
  setMuted,
  toggleBreakpoint,
  useBreakpoints,
} from '../../ide/features/debugger/breakpoints/store'
import { RunWidget } from '../../ide/features/run/RunWidget'
import { selectConfig, useRun } from '../../ide/features/run/store'
import { type RunConfig } from '../../ide/platform/ipc'

describe('M4 Empirical Challenge: Breakpoint Gutter & Run Widget', () => {
  const testFile = '/workspace/src/boundary.rs'

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    removeAllBreakpoints()
    setMuted(false)
    act(() => {
      useRun.setState({
        configs: [],
        selectedId: null,
        sessions: [],
        activeSession: null,
        versions: {},
      })
    })
  })

  describe('1. Breakpoint Gutter Boundary Coordinates & mapLines', () => {
    it('handles line 0, extreme lines, and maintains ascending sorted order', () => {
      let list: BreakpointEntry[] = []

      list = toggleLine(list, 0)
      list = toggleLine(list, 999_999)
      list = toggleLine(list, 42)
      list = toggleLine(list, 5)

      expect(list).toHaveLength(4)
      expect(list.map((b) => b.line)).toEqual([0, 5, 42, 999_999])

      // Toggling line 0 again removes it
      list = toggleLine(list, 0)
      expect(list.map((b) => b.line)).toEqual([5, 42, 999_999])
    })

    it('maps breakpoint lines accurately through document text insertions and deletions', () => {
      // 5-line document:
      // Line 0: "fn main() {"
      // Line 1: "    let a = 1;"
      // Line 2: "    let b = 2;"
      // Line 3: "    println!();"
      // Line 4: "}"
      const originalText = Text.of(['fn main() {', '    let a = 1;', '    let b = 2;', '    println!();', '}'])
      const breakpoints: BreakpointEntry[] = [
        { id: 'bp-1', line: 1, enabled: true, condition: null, logMessage: null, hitCondition: null },
        { id: 'bp-2', line: 3, enabled: true, condition: null, logMessage: null, hitCondition: null },
      ]

      // Insert 2 lines before line 1 (at position 0)
      const insertion = ChangeSet.of(
        { from: 0, to: 0, insert: '// Header comment\n// Another line\n' },
        originalText.length,
      )
      const updatedDoc = insertion.apply(originalText)
      const mapped = mapLines(breakpoints, originalText, insertion, updatedDoc)

      expect(mapped[0]?.line).toBe(3)
      expect(mapped[1]?.line).toBe(5)
    })

    it('deduplicates breakpoints when lines merge together during multiline deletion', () => {
      const originalDoc = Text.of(['line 0', 'line 1', 'line 2', 'line 3', 'line 4'])
      const breakpoints: BreakpointEntry[] = [
        { id: 'b1', line: 1, enabled: true, condition: null, logMessage: null, hitCondition: null },
        { id: 'b2', line: 2, enabled: true, condition: null, logMessage: null, hitCondition: null },
      ]

      // Delete lines 1 through 3
      const deletion = ChangeSet.of(
        { from: originalDoc.line(2).from, to: originalDoc.line(4).to, insert: '' },
        originalDoc.length,
      )
      const newDoc = deletion.apply(originalDoc)
      const mapped = mapLines(breakpoints, originalDoc, deletion, newDoc)

      // Merged breakpoints collapse to a single entry
      expect(mapped).toHaveLength(1)
      expect(mapped[0]?.id).toBe('b1')
    })
  })

  describe('2. Rapid Breakpoint Toggling & Debounced Backend Sync', () => {
    it('rapidly toggles the same line 100 times without state divergence', async () => {
      for (let i = 0; i < 100; i++) {
        toggleBreakpoint(testFile, 15)
      }

      // Even number of toggles leaves 0 breakpoints
      expect(breakpointsOf(testFile)).toHaveLength(0)

      // Odd toggle leaves 1 breakpoint
      toggleBreakpoint(testFile, 15)
      expect(breakpointsOf(testFile)).toHaveLength(1)
      expect(breakpointsOf(testFile)[0]?.line).toBe(15)

      // Drain debounced sync
      await flushBreakpoints()
      expect(breakpointsOf(testFile)).toHaveLength(1)
    })

    it('handles rapid concurrent breakpoint additions across multiple files', async () => {
      const fileCount = 20
      for (let f = 0; f < fileCount; f++) {
        const path = `/workspace/src/file_${f}.rs`
        addBreakpoint(path, 10 + f)
        addBreakpoint(path, 20 + f)
      }

      const allFiles = Object.keys(useBreakpoints.getState().byFile)
      expect(allFiles).toHaveLength(fileCount)

      for (let f = 0; f < fileCount; f++) {
        const path = `/workspace/src/file_${f}.rs`
        expect(breakpointsOf(path)).toHaveLength(2)
      }

      await flushBreakpoints()
    })
  })

  describe('3. Conditional Breakpoint Evaluation & Log Interpolation', () => {
    it('interpolates logpoint expressions and safely captures evaluation errors', async () => {
      const evaluate = vi.fn(async (expr: string) => {
        if (expr === 'err') throw new Error('Unresolved variable')
        if (expr === 'user.id') return '42'
        return `val(${expr})`
      })

      const template = 'User ID: {user.id}, Status: {status}, Error: {err}'
      const result = await interpolateLog(template, evaluate)

      expect(result).toBe('User ID: 42, Status: val(status), Error: <Unresolved variable>')
      expect(evaluate).toHaveBeenCalledWith('user.id')
      expect(evaluate).toHaveBeenCalledWith('status')
      expect(evaluate).toHaveBeenCalledWith('err')
    })

    it('correctly formats backend representations with conditions, logpoints, and muting', () => {
      const entries: BreakpointEntry[] = [
        {
          id: 'b-cond',
          line: 10,
          enabled: true,
          condition: 'x > 5',
          hitCondition: '>= 3',
          logMessage: null,
          suspend: true,
        },
        {
          id: 'b-log',
          line: 20,
          enabled: true,
          condition: null,
          hitCondition: null,
          logMessage: 'Log payload',
          suspend: false,
        },
        {
          id: 'b-disabled',
          line: 30,
          enabled: false,
          condition: null,
          hitCondition: null,
          logMessage: null,
          suspend: true,
        },
      ]

      // Normal unmuted backend formatting
      const backend1 = toBackend(entries, false, testFile)
      expect(backend1[0]?.enabled).toBe(true)
      expect(backend1[0]?.condition).toBe('x > 5')
      expect(backend1[0]?.hitCondition).toBe('>= 3')
      expect(backend1[1]?.enabled).toBe(true)
      expect(backend1[1]?.logMessage).toBe('Log payload')
      expect(backend1[2]?.enabled).toBe(false)

      // Muted: all breakpoints become enabled: false for DAP
      const backendMuted = toBackend(entries, true, testFile)
      expect(backendMuted.every((b) => !b.enabled)).toBe(true)
    })
  })

  describe('4. Title Bar Run Widget Concurrency & Rapid Switching', () => {
    const configA: RunConfig = {
      id: 'cfg-a',
      name: 'Build App',
      kind: 'shell',
      command: 'cargo',
      args: ['build'],
      cwd: null,
      env: {},
      detected: false,
      isTest: false,
      debugAdapter: null,
    }

    const configB: RunConfig = {
      id: 'cfg-b',
      name: 'Test App',
      kind: 'shell',
      command: 'cargo',
      args: ['test'],
      cwd: null,
      env: {},
      detected: false,
      isTest: false,
      debugAdapter: null,
    }

    it('renders selected config and executes run action on Run button click', async () => {
      act(() => {
        useRun.setState({
          configs: [configA, configB],
          selectedId: 'cfg-a',
        })
      })

      render(<RunWidget />)

      expect(screen.getByText('Build App')).toBeInTheDocument()
      const runBtn = screen.getByRole('button', { name: "Run 'Build App'" })
      expect(runBtn).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(runBtn)
      })
      expect(mockExecuteAction).toHaveBeenCalledWith('run.run')
    })

    it('updates widget display smoothly across rapid configuration switches', () => {
      act(() => {
        useRun.setState({
          configs: [configA, configB],
          selectedId: 'cfg-a',
        })
      })

      const { rerender } = render(<RunWidget />)
      expect(screen.getByText('Build App')).toBeInTheDocument()

      // Rapidly switch configuration to cfg-b
      act(() => {
        selectConfig('cfg-b')
      })
      rerender(<RunWidget />)
      expect(screen.getByText('Test App')).toBeInTheDocument()

      // Rapidly switch configuration to null
      act(() => {
        selectConfig(null)
      })
      rerender(<RunWidget />)
      expect(screen.getByText('Select Configuration')).toBeInTheDocument()
    })

    it('renders Stop button and kill process spinner when session is stopping', () => {
      act(() => {
        useRun.setState({
          configs: [configA],
          selectedId: 'cfg-a',
          sessions: [
            {
              id: 'sess-running',
              runId: 10,
              config: configA,
              status: 'stopping',
              startedAt: Date.now(),
              endedAt: null,
              exitCode: null,
              stdinClosed: false,
            },
          ],
        })
      })

      render(<RunWidget />)

      // When stopping, widget shows Kill process button
      const killBtn = screen.getByTitle('Kill process')
      expect(killBtn).toBeInTheDocument()

      fireEvent.click(killBtn)
      expect(mockExecuteAction).toHaveBeenCalledWith('run.stop', 'widget')
    })

    it('single-flights execution when Run button is triggered rapidly while launch is in flight', async () => {
      let resolveAction: () => void = () => {}
      mockExecuteAction.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveAction = resolve
          }),
      )

      act(() => {
        useRun.setState({
          configs: [configA],
          selectedId: 'cfg-a',
        })
      })

      render(<RunWidget />)

      const runBtn = screen.getByRole('button', { name: "Run 'Build App'" })

      // First click: begins launch
      await act(async () => {
        fireEvent.click(runBtn)
      })

      // Second click while in flight: should be blocked by single-flighting
      await act(async () => {
        fireEvent.click(runBtn)
      })

      // Exactly 1 action execution occurred
      expect(mockExecuteAction).toHaveBeenCalledTimes(1)

      // Resolve in-flight promise
      await act(async () => {
        resolveAction()
      })
    })
  })
})
