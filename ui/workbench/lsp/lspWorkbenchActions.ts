import { executeAction, registerAction } from '../../ide/platform/actions'
import { onIdeEvent } from '../../ide/platform/ipc'
import { notifications, registerStatusItem } from '../../ide/workbench/contributions'

import { LspStatusWidget } from './LspStatusWidget'
import {
  initLspServersEvents,
  useLspServersStore,
} from './lspServersStore'

/**
 * Registers workbench action `lsp.restart` and hooks into server status events
 * to surface installation guidance notifications when a server binary is missing or failed.
 */
export function registerLspWorkbenchActions(): () => void {
  const disposers: Array<() => void> = []

  // Register lsp.restart action
  disposers.push(
    registerAction({
      id: 'lsp.restart',
      title: 'Restart Language Server',
      category: 'LSP',
      description: 'Restart language server instances for the active workspace',
      icon: 'refresh',
      run: async ({ arg }) => {
        const serverId = typeof arg === 'number' ? arg : undefined
        await useLspServersStore.getState().restartServer(serverId)
      },
    }),
  )

  // Hook into language server status changes for guidance notifications
  const unlistenServer = onIdeEvent('languageServer', (e) => {
    if (e.status === 'missing' || e.status === 'crashed' || e.status === 'misconfigured') {
      const isMissing = e.status === 'missing'
      const title = `${e.name} Server ${isMissing ? 'Not Found' : 'Failed'}`
      const body =
        e.message ||
        (isMissing
          ? `Language server "${e.name}" is not installed or not found on PATH.`
          : `Language server "${e.name}" encountered a critical error.`)

      notifications().notify({
        group: 'lsp',
        level: 'warning',
        sticky: true,
        key: `lsp.status.${e.name}`,
        title,
        body,
        actions: [
          {
            label: 'Restart Server',
            run: () => {
              void executeAction('lsp.restart', e.server)
            },
          },
        ],
      })
    }
  })
  disposers.push(unlistenServer)

  // Hook into languageServerWarning
  const unlistenWarning = onIdeEvent('languageServerWarning', (e) => {
    notifications().notify({
      group: 'lsp',
      level: 'warning',
      sticky: true,
      key: `lsp.warning.${e.name}`,
      title: `${e.name} Capability Warning`,
      body: e.message || `Install ${e.installTool} to enable full language capabilities.`,
      actions: [
        {
          label: 'Restart Server',
          run: () => {
            void executeAction('lsp.restart')
          },
        },
      ],
    })
  })
  disposers.push(unlistenWarning)

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}

/**
 * Registers the status bar LSP indicator item `omniterm.lsp.status`.
 */
export function registerLspStatusItem(): () => void {
  return registerStatusItem({
    id: 'omniterm.lsp.status',
    title: 'Language Server',
    align: 'right',
    // After the branch widget, before the notifications bell (UI status bar layout).
    priority: 72,
    component: LspStatusWidget,
  })
}

/**
 * Integrates all workbench-level LSP features:
 * - Initializes LSP server event listeners
 * - Registers `lsp.restart` action and guidance notifications
 * - Registers status bar item `omniterm.lsp.status`
 */
export function registerLspWorkbench(): () => void {
  const disposers = [
    initLspServersEvents(),
    registerLspWorkbenchActions(),
    registerLspStatusItem(),
  ]

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
