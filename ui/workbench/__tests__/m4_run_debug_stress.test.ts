/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebug, type DebugSession } from '../../ide/features/debugger/state'
import { useRun, type RunSession } from '../../ide/features/run/store'
import type { RunConfig } from '../../ide/platform/ipc'
import { activateWorkbenchFeatures } from '../activateWorkbenchFeatures'
import { registerDebuggerWorkbench } from '../debugger/registerDebuggerWorkbench'
import { registerRunWorkbench } from '../run/registerRunWorkbench'
import { createScriptRunConfig, isScriptPath } from '../run/scriptRunProducer'
import { createSessionsHost } from '../sessionsHostCore'
import { useShellPanels } from '../shellPanelsStore'

describe('Milestone 4: Run & Debug Stress & Session Preservation Suite', () => {
  const disposers: Array<() => void> = []

  beforeEach(() => {
    // Activating the workbench registers OmniTerm's plugin source and probes the built-in Agent Quota
    // and Always Awake features; no plugins are installed and both features are off here.
    vi.stubGlobal('omnitermAPI', {
      agentQuota: { info: () => Promise.resolve(false) },
      alwaysAwake: { info: () => Promise.resolve(false) },
      plugin: {
        list: () => Promise.resolve([]),
        builtinIds: () => Promise.resolve([]),
        onChanged: () => () => {},
        setEnabled: () => Promise.resolve(null),
      },
    })
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
      useShellPanels.setState({
        sessions: null,
        bookmarks: null,
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    while (disposers.length > 0) {
      try {
        disposers.pop()?.()
      } catch {
        // Safe cleanup
      }
    }
    act(() => {
      useRun.setState({ sessions: [], configs: [] })
      useDebug.setState({ sessions: {} })
    })
  })

  describe('1. Rapid Start/Stop Lifecycle & Concurrency Stress', () => {
    it('rapidly starts and stops 100 run sessions while preserving store consistency', () => {
      const cycleCount = 100

      for (let i = 0; i < cycleCount; i++) {
        const config: RunConfig = {
          id: `stress-run-${i}`,
          name: `Stress Run ${i}`,
          kind: 'shell',
          command: 'echo',
          args: [`step-${i}`],
          cwd: null,
          env: {},
          detected: true,
          isTest: false,
          debugAdapter: null,
        }

        const session: RunSession = {
          id: `session-${i}`,
          runId: i + 1,
          config,
          status: 'running',
          startedAt: Date.now(),
          endedAt: null,
          stdinClosed: false,
          exitCode: null,
          stopped: false,
        }

        // Start session
        act(() => {
          useRun.setState((s) => ({
            sessions: [...s.sessions, session],
            activeSession: session.id,
            versions: { ...s.versions, [session.id]: (s.versions[session.id] ?? 0) + 1 },
          }))
        })

        // Concurrently stop previous if any
        if (i > 0 && i % 2 === 0) {
          const prevId = `session-${i - 1}`
          act(() => {
            useRun.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === prevId
                  ? { ...sess, status: 'finished', exitCode: 0, exitedAt: Date.now() }
                  : sess,
              ),
            }))
          })
        }
      }

      const state = useRun.getState()
      expect(state.sessions).toHaveLength(cycleCount)
      expect(state.activeSession).toBe(`session-${cycleCount - 1}`)
    })

    it('rapidly starts and transitions 50 debug sessions across status states', () => {
      const debugCount = 50
      const statuses: Array<DebugSession['status']> = [
        'starting',
        'running',
        'paused',
        'running',
        'terminated',
      ]

      for (let i = 1; i <= debugCount; i++) {
        const dummy = {
          id: i,
          name: `debug-stress-${i}`,
          adapter: 'lldb',
          status: 'starting',
          startedAt: Date.now(),
          threads: [{ id: 1, name: 'thread-1' }],
          frames: [],
          scopes: {},
          variables: {},
          capabilities: {},
          output: [],
        } as unknown as DebugSession

        act(() => {
          useDebug.setState((s) => ({
            sessions: { ...s.sessions, [i]: dummy },
            active: i,
          }))
        })

        // Cycle through all statuses
        for (const status of statuses) {
          act(() => {
            useDebug.setState((s) => ({
              sessions: {
                ...s.sessions,
                [i]: { ...s.sessions[i]!, status },
              },
            }))
          })
        }
      }

      const debugState = useDebug.getState()
      expect(Object.keys(debugState.sessions)).toHaveLength(debugCount)
      expect(debugState.sessions[debugCount]?.status).toBe('terminated')
    })
  })

  describe('2. Output Burst Throttling & Versioning', () => {
    it('handles 500 rapid version increments on active session without store desync', () => {
      const sessionId = 'burst-session-1'
      const session: RunSession = {
        id: sessionId,
        runId: 999,
        config: {
          id: 'burst-cfg',
          name: 'Burst Test',
          kind: 'shell',
          command: 'cat',
          args: [],
          cwd: null,
          env: {},
          detected: false,
          isTest: false,
          debugAdapter: null,
        },
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        stdinClosed: false,
        exitCode: null,
        stopped: false,
      }

      act(() => {
        useRun.setState({
          sessions: [session],
          activeSession: sessionId,
          versions: { [sessionId]: 0 },
        })
      })

      // Simulate 500 rapid chunks
      for (let chunk = 1; chunk <= 500; chunk++) {
        act(() => {
          useRun.setState((s) => ({
            versions: {
              ...s.versions,
              [sessionId]: (s.versions[sessionId] ?? 0) + 1,
            },
          }))
        })
      }

      expect(useRun.getState().versions[sessionId]).toBe(500)
    })
  })

  describe('3. Terminal Session Preservation', () => {
    it('preserves persistent terminal host element across workbench feature lifecycle changes', () => {
      // Create dedicated terminal host node
      const host = createSessionsHost()
      expect(host.dataset.sessionsHost).toBe('')

      // Set up persistent shell panels state
      const mockSessionsProps = {
        tabs: [{ id: 'term-1', title: 'PowerShell' }],
        activeTab: 'term-1',
      }
      act(() => {
        useShellPanels.setState({
          sessions: mockSessionsProps as never,
          bookmarks: null,
        })
      })

      // Mount host into a workbench DOM slot
      const workbenchContainer = document.createElement('div')
      workbenchContainer.appendChild(host)
      expect(workbenchContainer.contains(host)).toBe(true)

      // Repeatedly activate and deactivate workbench adapters (run & debugger)
      for (let cycle = 0; cycle < 20; cycle++) {
        const disposeRun = registerRunWorkbench()
        const disposeDebug = registerDebuggerWorkbench()

        // Modify run and debug stores heavily
        act(() => {
          useRun.setState({
            sessions: [
              {
                id: `sess-${cycle}`,
                runId: cycle,
                config: {
                  id: `cfg-${cycle}`,
                  name: `C-${cycle}`,
                  kind: 'shell',
                  command: 'sh',
                  args: [],
                  cwd: null,
                  env: {},
                  detected: true,
                  isTest: false,
                  debugAdapter: null,
                },
                status: 'running',
                startedAt: Date.now(),
                endedAt: null,
                stdinClosed: false,
                exitCode: null,
                stopped: false,
              },
            ],
            activeSession: `sess-${cycle}`,
          })
        })

        // Dispose adapters
        disposeRun()
        disposeDebug()

        // Verify host node remains completely attached and intact
        expect(workbenchContainer.contains(host)).toBe(true)
        expect(host.dataset.sessionsHost).toBe('')
        expect(useShellPanels.getState().sessions).toEqual(mockSessionsProps)
      }

      // Full workbench feature activation check
      const releaseWorkbench = activateWorkbenchFeatures()
      expect(workbenchContainer.contains(host)).toBe(true)
      expect(useShellPanels.getState().sessions).toEqual(mockSessionsProps)
      releaseWorkbench()
    })
  })

  describe('4. Script Producer Edge Cases & Security Confinement', () => {
    it('safely normalizes script paths with backslashes, dots, and unusual names', () => {
      const inputs = [
        { path: 'C:\\Users\\user\\scripts\\deploy.PS1', expectedKind: 'shell', name: 'deploy.PS1' },
        { path: 'rel/path/to/test.cmd', expectedKind: 'shell', name: 'test.cmd' },
        { path: 'nested\\folder\\run.BAT', expectedKind: 'shell', name: 'run.BAT' },
        { path: '/root/scripts/build.sh', expectedKind: 'shell', name: 'build.sh' },
      ]

      for (const item of inputs) {
        expect(isScriptPath(item.path)).toBe(true)
        const config = createScriptRunConfig({ path: item.path })
        expect(config.kind).toBe(item.expectedKind)
        expect(config.name).toBe(item.name)
        expect(config.id).toContain('omniterm:script:')
        expect(config.id).not.toContain('\\')
      }
    })
  })
})
