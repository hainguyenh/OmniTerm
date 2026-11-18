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
 * to offer a restart when a server fails.
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

  // A server that failed gets a notice to restart it. A missing one does not: code insight
  // (features/code-insight/servers.ts) already offers to install it, and restarting a server that
  // is not installed cannot help, so a second notice would only repeat the first.
  const unlistenServer = onIdeEvent('languageServer', (e) => {
    if (e.status !== 'crashed' && e.status !== 'misconfigured') return
    notifications().notify({
      group: 'lsp',
      level: 'warning',
      sticky: true,
      key: `lsp.status.${e.name}`,
      title: `${e.name} Server Failed`,
      body: e.message || `Language server "${e.name}" encountered a critical error.`,
      actions: [
        {
          label: 'Restart Server',
          run: () => {
            void executeAction('lsp.restart', e.server)
          },
        },
      ],
    })
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
