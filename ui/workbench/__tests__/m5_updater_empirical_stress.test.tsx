/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRun } from '../../ide/features/run/store'
import { useProject } from '../../ide/platform/project'
import { provideNotificationService, useDebugRunSessions } from '../../ide/workbench/contributions'
import { useNotifications } from '../../ide/workbench/notificationStore'
import { useTasks } from '../../ide/workbench/tasks'
import { registerUpdaterWorkbench } from '../updater/registerUpdaterWorkbench'
import { INSTALL_TASK_ID, UPDATE_KEY } from '../updater/updateTypes'
import {
  checkForUpdates,
  getUpdateSource,
  hasActiveSessions,
  installUpdate,
  notifyUpdate,
  requestRestart,
  setActiveSessionChecker,
  setUpdateSource,
} from '../updater/workbenchUpdater'

// Mock Tauri Channel
let latestChannel: { onmessage: ((msg: any) => void) | null } | null = null
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel {
    onmessage: ((msg: any) => void) | null = null
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      latestChannel = this
    }
  },
  invoke: vi.fn(),
}))

const mockCall = vi.fn()
const mockAppCheckUpdate = vi.fn()
const mockAppInstallUpdate = vi.fn()
const mockCancelRequest = vi.fn()
const mockAppRestart = vi.fn()
const mockAppUpdateWindowReady = vi.fn()
let ideEventListeners: Record<string, ((data: any) => void)[]> = {}

vi.mock('../../ide/platform/ipc', () => ({
  call: (promise: any) => mockCall(promise),
  commands: {
    appCheckUpdate: (source: any) => mockAppCheckUpdate(source),
    appInstallUpdate: (source: any, req: any, channel: any) =>
      mockAppInstallUpdate(source, req, channel),
    cancelRequest: (id: any) => mockCancelRequest(id),
    appRestart: () => mockAppRestart(),
    appBuildInfo: () => Promise.resolve({ version: '0.1.0' }),
    appUpdateWindowReady: (ready: any, locale: any) => mockAppUpdateWindowReady(ready, locale),
  },
  isCancelled: (err: any) => err?.message === 'cancelled',
  isTauri: () => true,
  nextRequestId: () => 101,
  onIdeEvent: (event: string, handler: (data: any) => void) => {
    ideEventListeners[event] = ideEventListeners[event] || []
    ideEventListeners[event].push(handler)
    return () => {
      ideEventListeners[event] = ideEventListeners[event]?.filter((h) => h !== handler)
    }
  },
}))

describe('Milestone 5 Empirical Stress Suite — Auto-Update Overhaul', () => {
  const notificationsLog: any[] = []
  const mockNotificationService = {
    notify: vi.fn((n: any) => {
      notificationsLog.push(n)
    }),
    expire: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    notificationsLog.length = 0
    latestChannel = null
    ideEventListeners = {}
    useTasks.setState({ tasks: [], indexing: null })
    useNotifications.setState({ items: [] })
    provideNotificationService(mockNotificationService)
    setActiveSessionChecker(null)
    setUpdateSource('github')
    mockCall.mockImplementation((p) => p)
    mockAppRestart.mockResolvedValue({ restarting: true })
    mockCancelRequest.mockResolvedValue(undefined)
    mockAppUpdateWindowReady.mockResolvedValue(undefined)
    useRun.setState({ sessions: [] })
    useDebugRunSessions.setState({ sessions: [] })
  })

  describe('Active Process & Session Guard Stress Testing', () => {
    it('blocks restart under any live run session status (starting, running, stopping)', async () => {
      const cleanup = registerUpdaterWorkbench()

      for (const status of ['starting', 'running', 'stopping'] as const) {
        useRun.setState({
          sessions: [
            {
              id: `run-${status}`,
              config: { id: 'cfg1', name: 'dev', type: 'cargo' } as any,
              runId: null,
              status,
              exitCode: null,
              startedAt: Date.now(),
              endedAt: null,
              stdinClosed: false,
            },
          ],
        })

        expect(hasActiveSessions()).toBe(true)
        await expect(requestRestart()).rejects.toThrow('ActiveSessionGuardError')
        expect(mockAppRestart).not.toHaveBeenCalled()

        const warnBalloon = notificationsLog.find((n) => n.title === 'Cannot restart OmniTerm')
        expect(warnBalloon).toBeDefined()
        expect(warnBalloon.key).toBe(UPDATE_KEY)
      }

      cleanup()
    })

    it('allows restart when run sessions are terminated (stopped, failed)', async () => {
      const cleanup = registerUpdaterWorkbench()

      for (const status of ['finished', 'failed'] as const) {
        useRun.setState({
          sessions: [
            {
              id: `run-${status}`,
              config: { id: 'cfg1', name: 'dev', type: 'cargo' } as any,
              runId: null,
              status,
              exitCode: status === 'finished' ? 0 : 1,
              startedAt: Date.now(),
              endedAt: Date.now(),
              stdinClosed: true,
            },
          ],
        })

        expect(hasActiveSessions()).toBe(false)
        await requestRestart()
        expect(mockAppRestart).toHaveBeenCalled()
        mockAppRestart.mockClear()
      }

      cleanup()
    })

    it('blocks restart when any debug session is active', async () => {
      const cleanup = registerUpdaterWorkbench()

      useDebugRunSessions.setState({
        sessions: [{ id: 'd-1', name: 'lldb-debug', type: 'lldb' } as any],
      })

      expect(hasActiveSessions()).toBe(true)
      await expect(requestRestart()).rejects.toThrow('ActiveSessionGuardError')
      expect(mockAppRestart).not.toHaveBeenCalled()

      // Terminate debug session
      useDebugRunSessions.setState({ sessions: [] })
      expect(hasActiveSessions()).toBe(false)
      await requestRestart()
      expect(mockAppRestart).toHaveBeenCalled()

      cleanup()
    })

    it('resets session checker on unmount and prevents dangling guards', async () => {
      const cleanup = registerUpdaterWorkbench()

      useRun.setState({
        sessions: [
          {
            id: 'run-live',
            config: { id: 'c1', name: 'web', type: 'node' } as any,
            runId: null,
            status: 'running',
            exitCode: null,
            startedAt: Date.now(),
            endedAt: null,
            stdinClosed: false,
          },
        ],
      })
      expect(hasActiveSessions()).toBe(true)

      // Unmount / cleanup
      cleanup()
      expect(hasActiveSessions()).toBe(false)
      await requestRestart()
      expect(mockAppRestart).toHaveBeenCalled()
    })
  })

  describe('Update Notification Balloon Deduplication & Key Replacement', () => {
    it('guarantees sticky balloon deduplication via stable key', () => {
      // Direct notification store integration
      for (let i = 0; i < 50; i++) {
        notifyUpdate(
          {
            version: `0.1.${i}`,
            currentVersion: '0.1.0',
            notes: `Notes ${i}`,
            date: null,
          },
          true,
        )
      }

      // Check notification service logs
      expect(notificationsLog).toHaveLength(50)
      for (const entry of notificationsLog) {
        expect(entry.key).toBe(UPDATE_KEY)
        expect(entry.sticky).toBe(true)
        expect(entry.group).toBe('updates')
      }
    })

    it('deduplicates background updateAvailable events and respects single-flight checking', async () => {
      const cleanup = registerUpdaterWorkbench()

      let checkResolved = false
      mockAppCheckUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              checkResolved = true
              resolve({
                enabled: true,
                update: {
                  version: '0.9.0',
                  currentVersion: '0.1.0',
                  notes: 'Fresh release',
                  date: null,
                },
              })
            }, 10)
          }),
      )

      // 10 rapid concurrent checkForUpdates calls
      const checks = Array.from({ length: 10 }, () => checkForUpdates('github'))
      await Promise.all(checks)

      // Exactly 1 appCheckUpdate call made due to single-flight locking
      expect(mockAppCheckUpdate).toHaveBeenCalledTimes(1)
      expect(checkResolved).toBe(true)

      cleanup()
    })
  })

  describe('Single-Flight Lock & Concurrency Resilience', () => {
    it('prevents concurrent installUpdate invocations', async () => {
      let resolveInstall: ((val: any) => void) | null = null
      mockAppInstallUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInstall = resolve
          }),
      )

      const p1 = installUpdate('1.0.0', 'github')
      const p2 = installUpdate('1.0.0', 'github')
      const p3 = installUpdate('1.0.0', 'github')

      expect(latestChannel).toBeDefined()
      // Exactly 1 IPC install call should be triggered
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(1)

      // Check task in status bar
      const task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task).toBeDefined()
      expect(task?.done).toBe(false)

      // Complete installation
      ;(resolveInstall as any)?.(null)
      await Promise.all([p1, p2, p3])

      // After completion, installing lock is released
      mockAppInstallUpdate.mockClear()
      mockAppInstallUpdate.mockResolvedValue(null)
      await installUpdate('1.0.1', 'github')
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(1)
    })

    it('safely handles download cancellation and releases installing lock', async () => {
      mockAppInstallUpdate.mockRejectedValue(new Error('cancelled'))

      await installUpdate('2.0.0', 'github')

      const cancelledNotify = notificationsLog.find((n) => n.title === 'Update cancelled')
      expect(cancelledNotify).toBeDefined()
      expect(cancelledNotify.actions[0].label).toBe('Retry with CNB')

      // Task is completed and cleaned up
      const task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task?.done).toBe(true)

      // Lock is released: next attempt succeeds
      mockAppInstallUpdate.mockResolvedValue(null)
      await installUpdate('2.0.0', 'github')
      const readyNotify = notificationsLog.find((n) => n.title.includes('is installed'))
      expect(readyNotify).toBeDefined()
    })
  })

  describe('Source Preference and Multi-Source Edge Cases', () => {
    it('persists and retrieves source preference across settings', () => {
      useProject.setState({ settings: { general: {}, appearance: {} } as never })
      setUpdateSource('github')
      expect(getUpdateSource()).toBe('github')

      setUpdateSource('cnb')
      expect(getUpdateSource()).toBe('cnb')
    })
  })
})
