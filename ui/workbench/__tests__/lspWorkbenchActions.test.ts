/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { registeredActions, registeredStatusItems, notificationsSent } = vi.hoisted(() => ({
  registeredActions: new Map<string, { id: string; title: string; run: (ctx: { arg?: unknown }) => unknown }>(),
  registeredStatusItems: new Map<string, { id: string; align: string; priority: number }>(),
  notificationsSent: [] as Array<{ level: string; title: string; body?: unknown; key?: string }>,
}))

vi.mock('../../ide/platform/actions', () => ({
  registerAction: vi.fn((action: { id: string; title: string; run: (ctx: { arg?: unknown }) => unknown }) => {
    registeredActions.set(action.id, action)
    return () => {
      registeredActions.delete(action.id)
    }
  }),
  executeAction: vi.fn(async (id: string, arg?: unknown) => {
    const act = registeredActions.get(id)
    if (act) await act.run({ arg })
  }),
}))

vi.mock('../../ide/workbench/contributions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/workbench/contributions')>()
  return {
    ...actual,
    notifications: () => ({
      notify: (n: { level: string; title: string; body?: unknown; key?: string }) => {
        notificationsSent.push(n)
      },
    }),
    registerStatusItem: vi.fn((item: { id: string; align: string; priority: number }) => {
      registeredStatusItems.set(item.id, item)
      return () => {
        registeredStatusItems.delete(item.id)
      }
    }),
  }
})

import { emitLocalIdeEvent } from '../../ide/platform/ipc'
import {
  registerLspStatusItem,
  registerLspWorkbench,
  registerLspWorkbenchActions,
} from '../lsp/lspWorkbenchActions'
import { useLspServersStore } from '../lsp/lspServersStore'

describe('lspWorkbenchActions & workbench wiring', () => {
  const disposers: Array<() => void> = []

  beforeEach(() => {
    registeredActions.clear()
    registeredStatusItems.clear()
    notificationsSent.length = 0
    useLspServersStore.getState().reset()
  })

  afterEach(() => {
    while (disposers.length) {
      disposers.pop()?.()
    }
  })

  it('registers lsp.restart action in the action registry', async () => {
    const dispose = registerLspWorkbenchActions()
    disposers.push(dispose)

    expect(registeredActions.has('lsp.restart')).toBe(true)
    const restartAction = registeredActions.get('lsp.restart')!
    expect(restartAction.title).toBe('Restart Language Server')

    const restartSpy = vi.spyOn(useLspServersStore.getState(), 'restartServer')
    await restartAction.run({ arg: 99 })
    expect(restartSpy).toHaveBeenCalledWith(99)

    dispose()
    expect(registeredActions.has('lsp.restart')).toBe(false)
  })

  it('displays guidance notification when a language server is reported missing', () => {
    const dispose = registerLspWorkbenchActions()
    disposers.push(dispose)

    emitLocalIdeEvent({
      type: 'languageServer',
      server: 101,
      name: 'rust-analyzer',
      status: 'missing',
      message: 'rust-analyzer not found. Install via rustup component add rust-analyzer',
    })

    expect(notificationsSent.length).toBe(1)
    const notif = notificationsSent[0]!
    expect(notif.level).toBe('warning')
    expect(notif.title).toContain('rust-analyzer')
    expect(notif.title).toContain('Not Found')
    expect(String(notif.body)).toContain('rustup component add rust-analyzer')
  })

  it('displays guidance notification on server crash', () => {
    const dispose = registerLspWorkbenchActions()
    disposers.push(dispose)

    emitLocalIdeEvent({
      type: 'languageServer',
      server: 102,
      name: 'vtsls',
      status: 'crashed',
      message: 'Process exited with code 1',
    })

    expect(notificationsSent.length).toBe(1)
    const notif = notificationsSent[0]!
    expect(notif.level).toBe('warning')
    expect(notif.title).toContain('Failed')
  })

  it('displays guidance notification on languageServerWarning', () => {
    const dispose = registerLspWorkbenchActions()
    disposers.push(dispose)

    emitLocalIdeEvent({
      type: 'languageServerWarning',
      name: 'clangd',
      message: 'clang-tidy missing',
      installTool: 'clang-tidy',
    })

    expect(notificationsSent.length).toBe(1)
    const notif = notificationsSent[0]!
    expect(notif.level).toBe('warning')
    expect(notif.title).toContain('clangd')
    expect(String(notif.body)).toContain('clang-tidy')
  })

  it('registers omniterm.lsp.status status item with priority 72 aligned right', () => {
    const dispose = registerLspStatusItem()
    disposers.push(dispose)

    expect(registeredStatusItems.has('omniterm.lsp.status')).toBe(true)
    const item = registeredStatusItems.get('omniterm.lsp.status')!
    expect(item.align).toBe('right')
    expect(item.priority).toBe(72)

    dispose()
    expect(registeredStatusItems.has('omniterm.lsp.status')).toBe(false)
  })

  it('registerLspWorkbench registers all actions, status item, and disposes in reverse cleanly', () => {
    const dispose = registerLspWorkbench()
    disposers.push(dispose)

    expect(registeredActions.has('lsp.restart')).toBe(true)
    expect(registeredStatusItems.has('omniterm.lsp.status')).toBe(true)

    dispose()

    expect(registeredActions.has('lsp.restart')).toBe(false)
    expect(registeredStatusItems.has('omniterm.lsp.status')).toBe(false)
  })
})
