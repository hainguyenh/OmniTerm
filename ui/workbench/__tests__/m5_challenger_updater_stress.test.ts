/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRun } from '../../ide/features/run/store'
import { provideNotificationService, useDebugRunSessions } from '../../ide/workbench/contributions'
import { useTasks } from '../../ide/workbench/tasks'
import { invoke } from '@tauri-apps/api/core'
import {
  INSTALL_TASK_ID,
  megabytes,
  progressText,
} from '../updater/updateTypes'
import {
  checkForUpdates,
  installUpdate,
  requestRestart,
  setActiveSessionChecker,
  setUpdateSource,
} from '../updater/workbenchUpdater'

// Mock Tauri Channel & invoke
let latestChannel: { onmessage: ((msg: any) => void) | null } | null = null
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel {
    onmessage: ((msg: any) => void) | null = null
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      latestChannel = this
    }
  },
  invoke: vi.fn().mockResolvedValue({ cancelled: true }),
}))

// Mock IPC platform
const mockCall = vi.fn()
const mockAppCheckUpdate = vi.fn()
const mockAppInstallUpdate = vi.fn()
const mockCancelRequest = vi.fn()
const mockAppRestart = vi.fn()

vi.mock('../../ide/platform/ipc', () => ({
  call: (promise: any) => mockCall(promise),
  commands: {
    appCheckUpdate: (source: any) => mockAppCheckUpdate(source),
    appInstallUpdate: (source: any, req: any, channel: any) =>
      mockAppInstallUpdate(source, req, channel),
    cancelRequest: (id: any) => mockCancelRequest(id),
    appRestart: () => mockAppRestart(),
    appBuildInfo: () => Promise.resolve({ version: '0.1.0' }),
  },
  isCancelled: (err: any) =>
    err?.message === 'cancelled' ||
    err?.code === 'cancelled' ||
    err?.toString().includes('cancelled'),
  isTauri: () => true,
  nextRequestId: () => 101,
  onIdeEvent: vi.fn(() => () => {}),
}))

describe('M5 Adversarial Stress & Concurrency Suite', () => {
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
    vi.mocked(invoke).mockResolvedValue({ cancelled: true })
    useRun.setState({ sessions: [] })
    useDebugRunSessions.setState({ sessions: [] })
  })

  describe('1. Concurrency & Single-Flight Dedup Stress', () => {
    it('collapses 50 concurrent checkForUpdates calls into a single IPC invocation', async () => {
      let resolveCheck: any
      const checkPromise = new Promise((resolve) => {
        resolveCheck = resolve
      })
      mockAppCheckUpdate.mockReturnValue(checkPromise)

      const calls = Array.from({ length: 50 }, () => checkForUpdates('github'))
      expect(mockAppCheckUpdate).toHaveBeenCalledTimes(1)

      resolveCheck({ enabled: true, update: null })
      await Promise.all(calls)
      expect(mockAppCheckUpdate).toHaveBeenCalledTimes(1)
    })

    it('collapses 50 concurrent installUpdate calls into a single installation flight', async () => {
      let resolveInstall: any
      const installPromise = new Promise((resolve) => {
        resolveInstall = resolve
      })
      mockAppInstallUpdate.mockReturnValue(installPromise)

      const calls = Array.from({ length: 50 }, () => installUpdate('0.2.0', 'github'))
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(1)

      resolveInstall(null)
      await Promise.all(calls)
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(1)

      // Subsequent call after resolution initiates a new flight
      let resolveSecond: any
      mockAppInstallUpdate.mockReturnValue(new Promise((r) => { resolveSecond = r }))
      const secondCall = installUpdate('0.2.1', 'github')
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(2)
      resolveSecond(null)
      await secondCall
    })

    it('releases single-flight promise when installation fails with an error', async () => {
      mockAppInstallUpdate.mockRejectedValueOnce(new Error('Network disconnected'))

      await installUpdate('0.2.0', 'github')
      const failBalloon = notificationsLog.find((n) => n.title === 'Could not install the update')
      expect(failBalloon).toBeDefined()

      // Lock is released: next call succeeds
      mockAppInstallUpdate.mockResolvedValueOnce(null)
      await installUpdate('0.2.0', 'github')
      expect(mockAppInstallUpdate).toHaveBeenCalledTimes(2)
    })
  })

  describe('2. Progress Streaming Bursts, Indeterminate & Extreme Values', () => {
    it('safely handles 1,000 rapid burst progress events without throwing or desyncing', async () => {
      let resolveInstall: any
      mockAppInstallUpdate.mockReturnValue(new Promise((r) => { resolveInstall = r }))

      const installPromise = installUpdate('0.2.0', 'github')
      expect(latestChannel).toBeDefined()

      const total = 100 * 1024 * 1024
      for (let i = 1; i <= 1000; i++) {
        latestChannel!.onmessage!({
          type: 'downloading',
          downloaded: (i / 1000) * total,
          total,
        })
      }

      const task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task).toBeDefined()
      expect(task?.fraction).toBe(1)
      expect(task?.message).toBe('100.0 MB of 100.0 MB')

      resolveInstall(null)
      await installPromise
    })

    it('correctly formats and clamps indeterminate and out-of-bounds progress values', () => {
      // 0 bytes / 0 total -> fraction null
      const zeroZero = progressText({ type: 'downloading', downloaded: 0, total: 0 })
      expect(zeroZero.fraction).toBeNull()
      expect(zeroZero.message).toBe('0.0 MB')

      // Negative or undefined downloaded -> defaults to 0
      const missingDownloaded = progressText({ type: 'downloading', downloaded: undefined as unknown as number, total: 100 })
      expect(missingDownloaded.fraction).toBe(0)
      expect(missingDownloaded.message).toBe('0.0 MB of 0.0 MB')

      // Downloaded exceeds total -> clamps fraction to 1.0
      const overflow = progressText({
        type: 'downloading',
        downloaded: 250 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })
      expect(overflow.fraction).toBe(1)
      expect(overflow.message).toBe('250.0 MB of 100.0 MB')

      // Negative downloaded with total -> clamped to 0
      const negative = progressText({
        type: 'downloading',
        downloaded: -50,
        total: 100,
      })
      expect(negative.fraction).toBe(0)

      // Extreme numbers: 50 GiB
      const fiftyGb = 50 * 1024 * 1024 * 1024
      const huge = progressText({ type: 'downloading', downloaded: fiftyGb, total: null })
      expect(huge.fraction).toBeNull()
      expect(huge.message).toBe('51200.0 MB')
      expect(megabytes(fiftyGb)).toBe('51200.0')
    })
  })

  describe('3. Mid-Stream Cancellation & Uncancellable Disk Replacement', () => {
    it('mid-stream cancellation purges active task and displays retry action', async () => {
      let rejectInstall: any
      mockAppInstallUpdate.mockReturnValue(new Promise((_, reject) => {
        rejectInstall = reject
      }))

      const installPromise = installUpdate('0.2.0', 'github')

      const task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task?.cancel).toBeDefined()

      // Invoke cancel
      task!.cancel!()
      expect(mockCancelRequest).toHaveBeenCalledWith(101)

      // Simulate backend response
      rejectInstall(new Error('cancelled'))
      await installPromise

      const cancelledBalloon = notificationsLog.find((n) => n.title === 'Update cancelled')
      expect(cancelledBalloon).toBeDefined()
      expect(cancelledBalloon.actions).toHaveLength(1)
      expect(cancelledBalloon.actions[0].label).toBe('Retry with CNB')

      // Task is finished
      const doneTask = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(doneTask?.done).toBe(true)
    })

    it('transitions to uncancellable mode once Installing state is emitted', async () => {
      let resolveInstall: any
      mockAppInstallUpdate.mockReturnValue(new Promise((r) => { resolveInstall = r }))

      const installPromise = installUpdate('0.2.0', 'github')

      // During download: cancellable
      latestChannel!.onmessage!({
        type: 'downloading',
        downloaded: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })
      let task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task?.cancel).toBeDefined()
      expect(task?.uncancellable).toBeUndefined()

      // Transition to Installing
      latestChannel!.onmessage!({ type: 'installing' })

      task = useTasks.getState().tasks.find((t) => t.id === INSTALL_TASK_ID)
      expect(task?.cancel).toBeUndefined()
      expect(task?.uncancellable).toBe("The update is being installed; this step can't be cancelled")
      expect(task?.message).toBe('Installing…')

      // Balloon is updated without Cancel button
      const lastBalloon = notificationsLog[notificationsLog.length - 1]
      expect(lastBalloon.actions).toBeUndefined()

      resolveInstall(null)
      await installPromise
    })
  })

  describe('4. Active Session Restart Guard Adversarial Verification', () => {
    it('blocks restart if a run session is in "starting" or "stopping" lifecycle states', async () => {
      setActiveSessionChecker(() => {
        return useRun.getState().sessions.some((s) => s.status === 'starting' || s.status === 'running' || s.status === 'stopping')
      })

      // Starting state
      useRun.setState({
        sessions: [{ id: 's1', status: 'starting' } as any],
      })
      await expect(requestRestart()).rejects.toThrow('ActiveSessionGuardError')
      expect(mockAppRestart).not.toHaveBeenCalled()

      // Stopping state
      useRun.setState({
        sessions: [{ id: 's1', status: 'stopping' } as any],
      })
      await expect(requestRestart()).rejects.toThrow('ActiveSessionGuardError')
      expect(mockAppRestart).not.toHaveBeenCalled()

      // Stopped state -> allowed
      useRun.setState({
        sessions: [{ id: 's1', status: 'stopped' } as any],
      })
      await requestRestart()
      expect(mockAppRestart).toHaveBeenCalledTimes(1)
    })
  })
})
