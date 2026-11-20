/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { executeAction, getAction, useActions } from '../../ide/platform/actions'
import { emitLocalIdeEvent } from '../../ide/platform/ipc'
import {
  provideNotificationService,
  useContributions,
} from '../../ide/workbench/contributions'
import {
  clearNotifications,
  notificationServiceImpl,
  useNotifications,
} from '../../ide/workbench/notificationStore'
import { activateWorkbenchFeatures } from '../activateWorkbenchFeatures'
import {
  normalizeStatus,
  useLspServersStore,
  type NormalizedLspStatus,
} from '../lsp/lspServersStore'
import {
  registerLspStatusItem,
  registerLspWorkbench,
  registerLspWorkbenchActions,
} from '../lsp/lspWorkbenchActions'
import { registerShellToolWindows } from '../registerShellToolWindows'

describe('M3 LSP Status & Store Adversarial Stress Suite', () => {
  const disposers: Array<() => void> = []

  beforeEach(() => {
    useLspServersStore.getState().reset()
    clearNotifications()
    provideNotificationService(notificationServiceImpl)
  })

  afterEach(() => {
    while (disposers.length > 0) {
      try {
        disposers.pop()?.()
      } catch {
        // Safe cleanup
      }
    }
    useLspServersStore.getState().reset()
    clearNotifications()
  })

  describe('1. 20+ Servers Lifecycle & State Machine Stress', () => {
    it('rapidly transitions 25 servers across all 6 lifecycle states while preserving store consistency', () => {
      const serverCount = 25
      const rawStatuses = [
        'starting',
        'ready',
        'missing',
        'failed',
        'crashed',
        'stopping',
        'stopped',
        'busy',
        'unknown',
      ]
      const expectedNormalized: NormalizedLspStatus[] = [
        'Starting',
        'Ready',
        'Missing',
        'Failed',
        'Idle',
        'Stopping',
      ]

      // Initialize 25 servers
      for (let i = 1; i <= serverCount; i++) {
        useLspServersStore.getState().setServer({
          id: i,
          name: `server-${i}`,
          languages: [`lang-${i}`],
          status: 'Idle',
          rawStatus: 'idle',
          message: null,
          installHint: null,
        })
      }

      expect(useLspServersStore.getState().servers.size).toBe(serverCount)
      expect(useLspServersStore.getState().overallStatus).toBe('Idle')

      // Perform 300 rapid sequential & random transitions
      for (let step = 0; step < 300; step++) {
        const targetId = (step % serverCount) + 1
        const raw = rawStatuses[step % rawStatuses.length]!
        useLspServersStore.getState().updateServerStatus(targetId, raw)

        const rec = useLspServersStore.getState().servers.get(targetId)
        expect(rec).toBeDefined()
        expect(expectedNormalized).toContain(rec!.status)
        expect(rec!.status).toBe(normalizeStatus(raw))
      }

      // Verify overallStatus strict precedence hierarchy:
      // Failed > Missing > Starting > Ready > Idle
      const store = useLspServersStore.getState()
      expect(store.servers.size).toBe(serverCount)

      // Test strict precedence: set all to Ready
      for (let i = 1; i <= serverCount; i++) {
        useLspServersStore.getState().updateServerStatus(i, 'Ready')
      }
      expect(useLspServersStore.getState().overallStatus).toBe('Ready')

      // 1 Starting elevates to Starting
      useLspServersStore.getState().updateServerStatus(5, 'Starting')
      expect(useLspServersStore.getState().overallStatus).toBe('Starting')

      // 1 Missing elevates over Starting
      useLspServersStore.getState().updateServerStatus(12, 'Missing')
      expect(useLspServersStore.getState().overallStatus).toBe('Missing')

      // 1 Failed elevates over Missing
      useLspServersStore.getState().updateServerStatus(20, 'Failed')
      expect(useLspServersStore.getState().overallStatus).toBe('Failed')

      // Pruning / Removal Stress: remove servers one-by-one and verify recalculated overall status
      useLspServersStore.getState().removeServer(20)
      expect(useLspServersStore.getState().overallStatus).toBe('Missing')

      useLspServersStore.getState().removeServer(12)
      expect(useLspServersStore.getState().overallStatus).toBe('Starting')

      useLspServersStore.getState().removeServer(5)
      expect(useLspServersStore.getState().overallStatus).toBe('Ready')

      // Remove all remaining servers
      for (let i = 1; i <= serverCount; i++) {
        useLspServersStore.getState().removeServer(i)
      }
      expect(useLspServersStore.getState().servers.size).toBe(0)
      expect(useLspServersStore.getState().overallStatus).toBe('Idle')
    })
  })

  describe('2. Burst lsp.restart Actions & In-Flight Concurrency', () => {
    it('survives burst rapid invocations of lsp.restart and non-existent IDs without corrupting state', async () => {
      const dispose = registerLspWorkbenchActions()
      disposers.push(dispose)

      // Seed running servers
      for (let id = 101; id <= 110; id++) {
        useLspServersStore.getState().setServer({
          id,
          name: `server-${id}`,
          languages: ['typescript'],
          status: 'Ready',
          rawStatus: 'ready',
          message: null,
          installHint: null,
        })
      }

      expect(getAction('lsp.restart')).toBeDefined()

      // Burst stress: 40 simultaneous clicks / executions
      const burstPromises: Array<Promise<boolean>> = []
      for (let i = 0; i < 40; i++) {
        const targetServerId = i % 3 === 0 ? 101 + (i % 10) : undefined
        burstPromises.push(executeAction('lsp.restart', targetServerId))
      }

      const results = await Promise.all(burstPromises)
      expect(results.every((r) => r === true)).toBe(true)
      expect(useLspServersStore.getState().isRestarting).toBe(false)

      // Burst restart with non-existent server IDs & negative IDs
      const nonExistentIds = [999999, -1, 0, 88888]
      for (const badId of nonExistentIds) {
        const ran = await executeAction('lsp.restart', badId)
        expect(ran).toBe(true)
      }

      expect(useLspServersStore.getState().isRestarting).toBe(false)
      // The non-existent server should have been initialized in Starting state safely
      expect(useLspServersStore.getState().servers.get(999999)?.status).toBe('Starting')
    })
  })

  describe('3. Guidance Notifications & Flood Protection', () => {
    it('notifies a crashed server and leaves a missing one to the install notice', () => {
      const dispose = registerLspWorkbenchActions()
      disposers.push(dispose)

      // Missing rust-analyzer
      emitLocalIdeEvent({
        type: 'languageServer',
        server: 201,
        name: 'rust-analyzer',
        status: 'missing',
        message: 'Binary not found on PATH',
      })

      let items = useNotifications.getState().items.filter((x) => x.group === 'lsp')
      expect(items.length).toBe(0)

      // Crashed server
      emitLocalIdeEvent({
        type: 'languageServer',
        server: 202,
        name: 'vtsls',
        status: 'crashed',
        message: 'vtsls process crashed with exit code 137',
      })

      items = useNotifications.getState().items.filter((x) => x.group === 'lsp')
      expect(items.length).toBe(1)
      const vtslsNotif = items.find((x) => x.key === 'lsp.status.vtsls')
      expect(vtslsNotif).toBeDefined()
      expect(vtslsNotif?.title).toContain('Failed')
      expect(vtslsNotif?.body).toContain('exit code 137')
      expect(vtslsNotif?.level).toBe('warning')
      expect(vtslsNotif?.sticky).toBe(true)
    })

    it('enforces flood protection: deduplicates rapid duplicate events with key clustering', () => {
      const dispose = registerLspWorkbenchActions()
      disposers.push(dispose)

      // Spam 50 missing events for rust-analyzer
      for (let i = 0; i < 50; i++) {
        emitLocalIdeEvent({
          type: 'languageServer',
          server: 301,
          name: 'rust-analyzer',
          status: 'missing',
          message: `Attempt ${i}: rust-analyzer not found`,
        })
      }

      // Spam 50 crashed events for pyright
      for (let i = 0; i < 50; i++) {
        emitLocalIdeEvent({
          type: 'languageServer',
          server: 302,
          name: 'pyright',
          status: 'crashed',
          message: `Crash ${i}: out of memory`,
        })
      }

      // Spam 50 capability warnings for gopls
      for (let i = 0; i < 50; i++) {
        emitLocalIdeEvent({
          type: 'languageServerWarning',
          name: 'gopls',
          message: 'gopls requires go installed',
          installTool: 'go install golang.org/x/tools/gopls@latest',
        })
      }

      const lspItems = useNotifications.getState().items.filter((x) => x.group === 'lsp')
      // Two notifications despite 150 incoming events; the missing server raises none here.
      expect(lspItems.length).toBe(2)
      expect(lspItems.map((n) => n.key).sort()).toEqual(['lsp.status.pyright', 'lsp.warning.gopls'])
    })
  })

  describe('4. Full Workbench Activation & Disposal Leak Verifier', () => {
    it('activates and cleanly disposes all actions, status items, tool windows, and event listeners with zero leaks', () => {
      expect(getAction('lsp.restart')).toBeUndefined()
      expect(useActions.getState().actions.has('lsp.restart')).toBe(false)
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(false)
      expect(useContributions.getState().toolWindows.has('problems')).toBe(false)

      const releaseWorkbench = activateWorkbenchFeatures([
        ['lsp-workbench', registerLspWorkbench],
        ['shell-tool-windows', registerShellToolWindows],
      ])

      // Assert full workbench mount
      expect(getAction('lsp.restart')).toBeDefined()
      expect(useActions.getState().actions.has('lsp.restart')).toBe(true)
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(true)
      expect(useContributions.getState().toolWindows.has('problems')).toBe(true)

      // Test active event delivery while mounted
      emitLocalIdeEvent({
        type: 'languageServer',
        server: 401,
        name: 'rust-analyzer',
        status: 'ready',
        message: null,
      })
      expect(useLspServersStore.getState().servers.get(401)?.status).toBe('Ready')

      // Deactivate workbench
      releaseWorkbench()

      // Assert zero registry leaks: all actions and contributions unregistered
      expect(getAction('lsp.restart')).toBeUndefined()
      expect(useActions.getState().actions.has('lsp.restart')).toBe(false)
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(false)
      expect(useContributions.getState().toolWindows.has('problems')).toBe(false)

      // Clear store to verify listeners were unsubscribed
      useLspServersStore.getState().reset()
      clearNotifications()

      // Post-deactivation event delivery should NOT affect store or trigger notifications
      emitLocalIdeEvent({
        type: 'languageServer',
        server: 401,
        name: 'rust-analyzer',
        status: 'ready',
        message: null,
      })
      emitLocalIdeEvent({
        type: 'languageServer',
        server: 402,
        name: 'crashed-after-dispose',
        status: 'crashed',
        message: 'Should not create notification',
      })

      expect(useLspServersStore.getState().servers.size).toBe(0)
      expect(useNotifications.getState().items.filter((x) => x.group === 'lsp').length).toBe(0)
    })

    it('handles nested multi-activation reference counting and idempotent releases', () => {
      const steps = [
        ['status-item', registerLspStatusItem],
        ['workbench-actions', registerLspWorkbenchActions],
      ] as const

      const release1 = activateWorkbenchFeatures(steps)
      const release2 = activateWorkbenchFeatures(steps)
      const release3 = activateWorkbenchFeatures(steps)

      expect(getAction('lsp.restart')).toBeDefined()
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(true)

      // First two releases should maintain active state (ref count > 0)
      release1()
      expect(getAction('lsp.restart')).toBeDefined()
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(true)

      release2()
      expect(getAction('lsp.restart')).toBeDefined()
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(true)

      // Duplicate call on release2 should be idempotent
      release2()
      expect(getAction('lsp.restart')).toBeDefined()

      // Final release unmounts everything
      release3()
      expect(getAction('lsp.restart')).toBeUndefined()
      expect(useContributions.getState().statusItems.has('omniterm.lsp.status')).toBe(false)
    })
  })
})
