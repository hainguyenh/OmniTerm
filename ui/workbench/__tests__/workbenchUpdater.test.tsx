/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRun } from '../../ide/features/run/store'
import { useProject } from '../../ide/platform/project'
import { provideNotificationService, useDebugRunSessions } from '../../ide/workbench/contributions'
import { useTasks } from '../../ide/workbench/tasks'
import { registerUpdaterWorkbench } from '../updater/registerUpdaterWorkbench'
import {
  CHECK_TASK_ID,
  INSTALL_TASK_ID,
  UPDATE_KEY,
  megabytes,
  progressText,
} from '../updater/updateTypes'
import { UpdateBalloonBody } from '../updater/UpdateBalloonBody'
import {
  checkForUpdates,
  getUpdateSource,
  hasActiveSessions,
  installUpdate,
  notifyUpdate,
  requestRestart,
  setActiveSessionChecker,
  setUpdateSource,
  updateSummary,
} from '../updater/workbenchUpdater'

// Mock Tauri core Channel
let latestChannel: { onmessage: ((msg: any) => void) | null } | null = null
function setLatestChannel(ch: { onmessage: ((msg: any) => void) | null }) {
  latestChannel = ch
}
vi.mock('@tauri-apps/api/core', () => {
  return {
    Channel: class MockChannel {
      onmessage: ((msg: any) => void) | null = null
      constructor() {
        setLatestChannel(this)
      }
    },
  }
})

// Mock IPC platform
const mockCall = vi.fn()
const mockAppCheckUpdate = vi.fn()
const mockAppInstallUpdate = vi.fn()
const mockCancelRequest = vi.fn()
const mockAppRestart = vi.fn()
const mockAppUpdateWindowReady = vi.fn()
const mockOnIdeEvent = vi.fn((..._args: any[]) => () => {})

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
  nextRequestId: () => 42,
  onIdeEvent: (ev: any, cb: any) => mockOnIdeEvent(ev, cb),
}))

describe('WorkbenchUpdater', () => {
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
    useTasks.setState({ tasks: [], indexing: null })
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

  describe('updateTypes & formatting', () => {
    it('defines stable task IDs and keys', () => {
      expect(CHECK_TASK_ID).toBe('app.update.check')
      expect(INSTALL_TASK_ID).toBe('app.update.install')
      expect(UPDATE_KEY).toBe('app.update')
    })

    it('formats bytes into megabytes with one decimal', () => {
      expect(megabytes(1024 * 1024)).toBe('1.0')
      expect(megabytes(5.5 * 1024 * 1024)).toBe('5.5')
    })

    it('formats downloading progress with known total', () => {
      const summary = progressText({
        type: 'downloading',
        downloaded: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })
      expect(summary.message).toBe('50.0 MB of 100.0 MB')
      expect(summary.fraction).toBe(0.5)
    })

    it('clamps downloading fraction between 0 and 1', () => {
      const overflow = progressText({
        type: 'downloading',
        downloaded: 150 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })
      expect(overflow.fraction).toBe(1)
    })

    it('formats indeterminate downloading progress without total', () => {
      const summary = progressText({
        type: 'downloading',
        downloaded: 25 * 1024 * 1024,
        total: null,
      })
      expect(summary.message).toBe('25.0 MB')
      expect(summary.fraction).toBeNull()
    })

    it('formats installing state with null fraction', () => {
      const summary = progressText({ type: 'installing' })
      expect(summary.message).toBe('Installing…')
      expect(summary.fraction).toBeNull()
    })
  })

  describe('source selection (Feature 39)', () => {
    it('gets and sets update source endpoint', () => {
      useProject.setState({ settings: { general: {}, appearance: {} } as never })
      expect(getUpdateSource()).toBe('github')
      setUpdateSource('cnb')
      expect(getUpdateSource()).toBe('cnb')
    })
  })

  describe('status bar tasks & balloons (Features 37 & 38)', () => {
    it('registers background check task and handles up to date result', async () => {
      mockAppCheckUpdate.mockResolvedValue({ enabled: true, update: null })
      await checkForUpdates('github')

      expect(mockAppCheckUpdate).toHaveBeenCalledWith('github')
      const notify = notificationsLog.find((n) => n.title === 'OmniTerm 0.1.0 is up to date')
      expect(notify).toBeDefined()
      expect(notify.key).toBe(UPDATE_KEY)
    })

    it('emits update available sticky balloon when new release found', async () => {
      mockAppCheckUpdate.mockResolvedValue({
        enabled: true,
        update: {
          version: '0.2.0',
          currentVersion: '0.1.14',
          notes: 'Important fixes',
          date: '2026-11-10',
        },
      })
      await checkForUpdates('github')

      const balloon = notificationsLog.find((n) => n.title.includes('is available'))
      expect(balloon).toBeDefined()
      expect(balloon.sticky).toBe(true)
      expect(balloon.actions).toHaveLength(1)
      expect(balloon.actions[0].label).toBe('Install and Restart')
    })

    it('notifies update manually with notifyUpdate', () => {
      notifyUpdate(
        {
          version: '0.3.0',
          currentVersion: '0.2.0',
          notes: 'Changelog',
          date: null,
        },
        true,
      )
      const balloon = notificationsLog.find((n) => n.title === 'OmniTerm 0.3.0 is available')
      expect(balloon).toBeDefined()
      expect(balloon?.actions).toHaveLength(1)
    })

    it('shows only the first paragraph of the notes in the balloon', () => {
      expect(updateSummary('First.\n\nSecond.')).toBe('First.')
      expect(updateSummary('   ')).toBeUndefined()
      expect(updateSummary('x'.repeat(400))).toBe('x'.repeat(300) + '…')
    })

    it('offers the other update source after a failed download and installs from it', async () => {
      mockAppInstallUpdate.mockRejectedValueOnce(new Error('boom'))
      await installUpdate('0.2.0', 'github')
      const failed = notificationsLog.find((n) => n.title === 'Could not install the update')
      expect(failed.actions.map((a: any) => a.label)).toEqual(['Retry', 'Retry with CNB'])
      mockAppInstallUpdate.mockResolvedValue(undefined)
      failed.actions[1].run()
      await vi.waitFor(() => expect(mockAppInstallUpdate).toHaveBeenLastCalledWith('cnb', 42, expect.anything()))
      setUpdateSource('github')
    })

    it('registers status bar update task on install start and updates progress', async () => {
      let resolveInstall: any
      const installPromise = new Promise((resolve) => {
        resolveInstall = resolve
      })
      mockAppInstallUpdate.mockReturnValue(installPromise)

      const p = installUpdate('0.2.0', 'github')

      // Check task in status bar
      const task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task).toBeDefined()
      expect(task?.title).toBe('Downloading update 0.2.0')
      expect(task?.cancel).toBeDefined()

      // Stream progress chunk via channel
      expect(latestChannel).toBeDefined()
      latestChannel!.onmessage?.({
        type: 'downloading',
        downloaded: 40 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })

      const updatedTask = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(updatedTask?.fraction).toBe(0.4)
      expect(updatedTask?.message).toBe('40.0 MB of 100.0 MB')

      // Stream installing state
      latestChannel!.onmessage?.({ type: 'installing' })
      const installingTask = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(installingTask?.fraction).toBeNull()
      expect(installingTask?.cancel).toBeUndefined()
      expect(installingTask?.uncancellable).toBeDefined()

      resolveInstall(null)
      await p

      const readyBalloon = notificationsLog.find((n) => n.title.includes('is installed'))
      expect(readyBalloon).toBeDefined()
      expect(readyBalloon.actions[0].label).toBe('Restart')
    })

    it('cancelling active download invokes cancelRequest and notifies', async () => {
      mockAppInstallUpdate.mockRejectedValue(new Error('cancelled'))

      await installUpdate('0.2.0', 'github')

      const cancelledBalloon = notificationsLog.find((n) => n.title === 'Update cancelled')
      expect(cancelledBalloon).toBeDefined()
      expect(cancelledBalloon.actions[0].label).toBe('Retry with CNB')
    })
  })

  describe('restart active session guard (Feature 36 & Tier 3)', () => {
    it('refuses restart when active session checker reports running process', async () => {
      setActiveSessionChecker(() => true)
      expect(hasActiveSessions()).toBe(true)

      await expect(requestRestart()).rejects.toThrow('ActiveSessionGuardError')
      expect(mockAppRestart).not.toHaveBeenCalled()

      const warnBalloon = notificationsLog.find((n) => n.title === 'Cannot restart OmniTerm')
      expect(warnBalloon).toBeDefined()
    })

    it('allows restart when no active sessions are running', async () => {
      setActiveSessionChecker(() => false)
      expect(hasActiveSessions()).toBe(false)

      await requestRestart()
      expect(mockAppRestart).toHaveBeenCalled()
    })
  })

  describe('UpdateBalloonBody Component', () => {
    it('renders progress bar for active install task', () => {
      useTasks.setState({
        tasks: [
          {
            id: INSTALL_TASK_ID,
            title: 'Downloading update 0.2.0',
            message: '50.0 MB of 100.0 MB',
            fraction: 0.5,
            done: false,
            startedAt: Date.now(),
          },
        ],
        indexing: null,
      })

      const { container } = render(<UpdateBalloonBody task={INSTALL_TASK_ID} />)
      expect(container.textContent).toContain('50.0 MB of 100.0 MB')
    })

    it('returns null if task is done or missing', () => {
      const { container } = render(<UpdateBalloonBody task="unknown.task" />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('registerUpdaterWorkbench lifecycle & live session integration', () => {
    it('wires real session checking and signals window readiness', () => {
      const cleanup = registerUpdaterWorkbench()
      expect(mockAppUpdateWindowReady).toHaveBeenCalledWith(true, expect.any(String))

      // No active sessions
      expect(hasActiveSessions()).toBe(false)

      // Active live run session
      useRun.setState({
        sessions: [
          {
            id: 'run-1',
            config: { id: 'c1', name: 'dev', type: 'node' } as any,
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

      // Terminated run session
      useRun.setState({
        sessions: [
          {
            id: 'run-1',
            config: { id: 'c1', name: 'dev', type: 'node' } as any,
            runId: null,
            status: 'finished',
            exitCode: 0,
            startedAt: Date.now(),
            endedAt: Date.now(),
            stdinClosed: true,
          },
        ],
      })
      expect(hasActiveSessions()).toBe(false)

      // Active debug session
      useDebugRunSessions.setState({
        sessions: [{ id: 'dbg-1', name: 'debug', type: 'node' } as any],
      })
      expect(hasActiveSessions()).toBe(true)

      // Clean up on deactivation
      useDebugRunSessions.setState({ sessions: [] })
      cleanup()
      expect(mockAppUpdateWindowReady).toHaveBeenCalledWith(false, '')
      expect(hasActiveSessions()).toBe(false)
    })
  })
})
