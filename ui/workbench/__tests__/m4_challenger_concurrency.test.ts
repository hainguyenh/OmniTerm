/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/platform/ipc', () => ({
  call: vi.fn(() => Promise.resolve([])),
  commands: {
    runStart: vi.fn(),
    runStop: vi.fn(() => Promise.resolve()),
    runConfigs: vi.fn(() => Promise.resolve([])),
    runSaveConfigs: vi.fn(() => Promise.resolve()),
    runApplySettings: vi.fn((c: unknown) => Promise.resolve(c)),
    cancelRequest: vi.fn(() => Promise.resolve()),
  },
  isTauri: vi.fn(() => true),
  isCancelled: vi.fn(() => false),
  nextRequestId: vi.fn(() => 1),
}))

import { useDebug, type DebugSession } from '../../ide/features/debugger/state'
import { ConsoleModel } from '../../ide/features/run/console'
import { type OutputChunk, type RunConfig } from '../../ide/platform/ipc'
import {
  isLive,
  stopSession,
  useRun,
  type RunSession,
} from '../../ide/features/run/store'

describe('M4 Empirical Challenge: Concurrency & High Load Stress', () => {
  beforeEach(() => {
    act(() => {
      useRun.setState({
        configs: [],
        selectedId: null,
        sessions: [],
        activeSession: null,
        versions: {},
      })
      useDebug.setState({
        sessions: {},
        active: null,
      })
    })
  })

  afterEach(() => {
    act(() => {
      useRun.setState({ sessions: [], configs: [], versions: {} })
      useDebug.setState({ sessions: {}, active: null })
    })
  })

  describe('1. High-Frequency Event Streaming & Output Flooding', () => {
    it('processes 2,000 rapid output chunks through ConsoleModel within char limit', () => {
      const charLimit = 50_000
      const consoleModel = new ConsoleModel({ maxChars: charLimit })

      const chunks: OutputChunk[] = Array.from({ length: 2000 }, (_, i) => ({
        kind: i % 3 === 0 ? 'stdout' : i % 3 === 1 ? 'stderr' : 'system',
        text: `[Stream-Chunk-${String(i).padStart(4, '0')}] Data payload with ansi \u001b[32mOK\u001b[0m\n`,
      }))

      for (const chunk of chunks) {
        consoleModel.append(chunk)
      }
      consoleModel.flush()

      const text = consoleModel.text()
      expect(text.length).toBeLessThanOrEqual(charLimit + 200)
      expect(text).toContain('Stream-Chunk-1999')
      expect(consoleModel.lines.length).toBeGreaterThan(100)
    })

    it('enforces FIFO line truncation when output volume exceeds maximum characters', () => {
      const maxChars = 500
      const model = new ConsoleModel({ maxChars })

      for (let i = 0; i < 50; i++) {
        model.append({
          kind: 'stdout',
          text: `Line ${String(i).padStart(2, '0')}: A quick brown fox jumps over the lazy dog\n`,
        })
      }
      model.flush()

      const content = model.text()
      expect(content.length).toBeLessThanOrEqual(maxChars + 60)
      expect(content).not.toContain('Line 00:')
      expect(content).toContain('Line 49:')
    })

    it('handles ANSI escape sequences and carriage return overwrites without crash', () => {
      const model = new ConsoleModel()

      const ansiStream = [
        '\u001b[31mError:\u001b[0m Connection failed\n',
        'Progress: [    ] 0%\rProgress: [==  ] 50%\rProgress: [====] 100%\n',
        '\u001b[1;34mInfo:\u001b[0m Finished successfully\n',
      ]

      for (const text of ansiStream) {
        model.append({ kind: 'stdout', text })
      }
      model.flush()

      const rendered = model.text()
      expect(rendered).toContain('Connection failed')
      expect(rendered).toContain('Finished successfully')
      expect(rendered).toContain('100%')
    })
  })

  describe('2. Rapid Session Restarts & Tab Generation Integrity', () => {
    it('manages 50 rapid sequential session restarts on the same session ID', () => {
      const config: RunConfig = {
        id: 'fast-restart-cfg',
        name: 'Fast Restart Target',
        kind: 'shell',
        command: 'cargo',
        args: ['check'],
        cwd: null,
        env: {},
        detected: false,
        isTest: false,
        debugAdapter: null,
      }

      for (let gen = 1; gen <= 50; gen++) {
        const session: RunSession = {
          id: 'restart-tab-1',
          runId: gen,
          config,
          status: 'running',
          startedAt: Date.now(),
          endedAt: null,
          exitCode: null,
          stdinClosed: false,
        }

        act(() => {
          useRun.setState((s) => ({
            sessions: [session],
            activeSession: session.id,
            versions: { ...s.versions, [session.id]: gen },
          }))
        })

        // Simulate fast process termination
        act(() => {
          useRun.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === session.id
                ? { ...sess, status: 'finished', exitCode: gen % 2 === 0 ? 0 : 1, endedAt: Date.now() }
                : sess,
            ),
          }))
        })
      }

      const finalState = useRun.getState()
      expect(finalState.sessions).toHaveLength(1)
      expect(finalState.sessions[0]?.runId).toBe(50)
      expect(finalState.sessions[0]?.status).toBe('finished')
      expect(finalState.versions['restart-tab-1']).toBe(50)
    })
  })

  describe('3. Debugger Concurrency & Deep Call Stacks', () => {
    it('survives rapid thread switches across 20 threads with 100 stack frames each', () => {
      const threadCount = 20
      const frameCount = 100

      const threads = Array.from({ length: threadCount }, (_, i) => ({
        id: i + 1,
        name: `worker-thread-${i + 1}`,
      }))

      const frames = Array.from({ length: frameCount }, (_, i) => ({
        id: i,
        name: `frame_${i}()`,
        line: i * 2 + 1,
        column: 4,
        path: '/workspace/src/deep_recursion.rs',
        presentationHint: null,
      }))

      const debugSession = {
        id: 101,
        name: 'Deep Debugger Session',
        adapter: 'lldb',
        status: 'paused',
        startedAt: Date.now(),
        threads,
        frames,
        scopes: {},
        variables: {},
        capabilities: {},
        output: [],
        selectedThread: 1,
      } as unknown as DebugSession

      act(() => {
        useDebug.setState({
          sessions: { 101: debugSession },
          active: 101,
        })
      })

      // Rapidly toggle active threads
      for (let t = 1; t <= threadCount; t++) {
        act(() => {
          useDebug.setState((s) => {
            const sess = s.sessions[101]
            if (!sess) return s
            return {
              sessions: {
                ...s.sessions,
                101: { ...sess, selectedThread: t },
              },
            }
          })
        })
      }

      const finalDebug = useDebug.getState().sessions[101]
      expect(finalDebug?.threads).toHaveLength(threadCount)
      expect(finalDebug?.frames).toHaveLength(frameCount)
      expect(finalDebug?.selectedThread).toBe(threadCount)
    })
  })

  describe('4. Stop Idempotency Under Concurrent Invocations', () => {
    it('safely handles multiple concurrent stop calls on a running session', async () => {
      const session: RunSession = {
        id: 'stop-concurrent-1',
        runId: 42,
        config: {
          id: 'cfg-stop',
          name: 'Stop Test',
          kind: 'shell',
          command: 'sleep',
          args: ['100'],
          cwd: null,
          env: {},
          detected: false,
          isTest: false,
          debugAdapter: null,
        },
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        exitCode: null,
        stdinClosed: false,
      }

      act(() => {
        useRun.setState({
          sessions: [session],
          activeSession: session.id,
        })
      })

      expect(isLive(useRun.getState().sessions[0]!)).toBe(true)

      // Invoke 5 concurrent stops
      await Promise.all([
        stopSession(session.id),
        stopSession(session.id),
        stopSession(session.id),
        stopSession(session.id),
        stopSession(session.id),
      ])

      const stopped = useRun.getState().sessions[0]
      expect(stopped?.stopped).toBe(true)
      expect(stopped?.status).toBe('stopping')
    })

    it('returns safely and idempotently when stopping an already finished session', async () => {
      const session: RunSession = {
        id: 'stop-finished-1',
        runId: 99,
        config: {
          id: 'cfg-finished',
          name: 'Finished Test',
          kind: 'shell',
          command: 'echo',
          args: [],
          cwd: null,
          env: {},
          detected: false,
          isTest: false,
          debugAdapter: null,
        },
        status: 'finished',
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        exitCode: 0,
        stdinClosed: true,
      }

      act(() => {
        useRun.setState({
          sessions: [session],
          activeSession: session.id,
        })
      })

      expect(isLive(useRun.getState().sessions[0]!)).toBe(false)

      await stopSession(session.id)
      await stopSession(session.id)

      const current = useRun.getState().sessions[0]
      expect(current?.status).toBe('finished')
      expect(current?.exitCode).toBe(0)
    })

    it('returns safely and idempotently when stopping a non-existent session ID', async () => {
      await expect(stopSession('non-existent-session-id')).resolves.toBeUndefined()
    })
  })
})
