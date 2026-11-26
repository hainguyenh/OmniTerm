/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenuItem } from '../../ide/ui/Menu'
import { resetSessionBridge, useSessionBridge, type SessionBridgeApi, type SessionInfo } from '../sessions/sessionBridge'
import { sessionInput } from '../sessions/sessionInput'

const mocks = vi.hoisted(() => ({
  renew: vi.fn(),
  move: vi.fn(),
  copy: vi.fn(),
  save: vi.fn(),
  bookmark: vi.fn(),
  registerMenuGroup: vi.fn(() => () => {}),
}))
vi.mock('../../hooks/useRenewSession', () => ({ requestRenewFromPane: mocks.renew }))
vi.mock('../terminalDock/terminalDockActions', () => ({ moveSessionToTerminalWindow: mocks.move }))
vi.mock('../../utils/terminalCopyExtract', () => ({ dispatchTerminalCopy: mocks.copy, dispatchTerminalSave: mocks.save }))
vi.mock('../../utils/agentBookmark', () => ({ agentBookmark: mocks.bookmark }))
vi.mock('../../ide/workbench/contributions', () => ({ registerMenuGroup: mocks.registerMenuGroup }))

import { interruptSession, registerSessionTabMenu, sessionTabMenuItems } from '../sessions/sessionTabMenu'

type Entry = MenuItem & { label?: string; run?: () => void; submenu?: MenuItem[]; disabled?: boolean; checked?: boolean }

const connect = {
  localInput: vi.fn(),
  sshInput: vi.fn(),
  interruptSession: vi.fn((): Promise<void> => Promise.resolve()),
}
const openInSystem = vi.fn(() => Promise.resolve())
const terminalThemes = vi.fn((): ReturnType<NonNullable<SessionBridgeApi['terminalThemes']>> => ({
  themes: [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }],
  current: 'light',
}))
const applyTerminalTheme = vi.fn()
const api = { killSession: vi.fn(), terminalThemes, applyTerminalTheme } as unknown as SessionBridgeApi

const info = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  connId: id,
  name: id,
  connType: 'LOCAL',
  workspaceId: null,
  status: 'connected',
  busy: false,
  cwd: 'D:\\work\\repo',
  hasCommand: false,
  ...over,
})
const publish = (...sessions: SessionInfo[]) => useSessionBridge.setState({ sessions, api, restoreSettled: true })
const labels = (items: MenuItem[]) => items.flatMap((item) => ((item as Entry).label ? [(item as Entry).label] : []))
const find = (items: MenuItem[], label: string): Entry => {
  const item = items.find((entry) => (entry as Entry).label === label)
  if (!item) throw new Error(`no menu item ${label}`)
  return item as Entry
}

beforeEach(() => {
  Object.assign(window, { omnitermAPI: { connect, app: { openInSystem } } })
  mocks.bookmark.mockReturnValue(null)
})
afterEach(() => {
  resetSessionBridge()
  vi.clearAllMocks()
})

describe('session tab menu', () => {
  it('offers every action of a running local shell', () => {
    publish(info('a'))
    expect(labels(sessionTabMenuItems('a'))).toEqual([
      'Terminal Theme',
      'Stop Current Process',
      'Clear Terminal',
      'Copy',
      'Save Terminal Output…',
      'Renew Session',
      'Open Folder in Explorer',
      'Move to Terminal Tool Window',
    ])
  })

  it('runs each action against the session', () => {
    publish(info('a'))
    const items = sessionTabMenuItems('a')
    find(items, 'Clear Terminal').run?.()
    expect(connect.localInput).toHaveBeenCalledWith('a', '\x0c')
    for (const entry of find(items, 'Copy').submenu ?? []) (entry as Entry).run?.()
    expect(mocks.copy.mock.calls).toEqual([['a', 'last-output'], ['a', 'viewport'], ['a', 'all']])
    find(items, 'Save Terminal Output…').run?.()
    expect(mocks.save).toHaveBeenCalledWith('a')
    find(items, 'Renew Session').run?.()
    expect(mocks.renew).toHaveBeenCalledWith('a')
    find(items, 'Open Folder in Explorer').run?.()
    expect(openInSystem).toHaveBeenCalledWith('D:\\work\\repo')
    find(items, 'Move to Terminal Tool Window').run?.()
    expect(mocks.move).toHaveBeenCalledWith('a')
  })

  it('lists the terminal themes with the current one checked, and applies a choice', () => {
    publish(info('a'))
    const themes = (find(sessionTabMenuItems('a'), 'Terminal Theme').submenu ?? []) as Entry[]
    expect(themes.map((theme) => [theme.label, theme.checked])).toEqual([
      ['Dark', false],
      ['Light', true],
    ])
    themes[0]?.run?.()
    expect(applyTerminalTheme).toHaveBeenCalledWith('a', 'dark')
  })

  it('leaves out the theme menu when there are no themes', () => {
    terminalThemes.mockReturnValueOnce(null)
    publish(info('a'))
    expect(labels(sessionTabMenuItems('a'))).not.toContain('Terminal Theme')
  })

  it('disables input actions of an ended session', () => {
    publish(info('a', { status: 'closed' }))
    const items = sessionTabMenuItems('a')
    expect(find(items, 'Stop Current Process').disabled).toBe(true)
    expect(find(items, 'Clear Terminal').disabled).toBe(true)
  })

  it('offers only terminal actions for SSH, and nothing terminal-like for RDP', () => {
    publish(info('s', { connType: 'SSH' }), info('r', { connType: 'RDP' }))
    const ssh = sessionTabMenuItems('s')
    expect(labels(ssh)).not.toContain('Renew Session')
    expect(labels(ssh)).not.toContain('Open Folder in Explorer')
    find(ssh, 'Clear Terminal').run?.()
    expect(connect.sshInput).toHaveBeenCalledWith('s', '\x0c')
    expect(labels(sessionTabMenuItems('r'))).toEqual(['Terminal Theme'])
  })

  it('shows the agent bookmark state and toggles it', () => {
    const toggle = vi.fn()
    mocks.bookmark.mockReturnValue({ state: 'bookmarked', toggle })
    publish(info('a'))
    find(sessionTabMenuItems('a'), 'Remove Bookmark').run?.()
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('has nothing for an unknown session', () => {
    expect(sessionTabMenuItems('nobody')).toEqual([])
  })
})

describe('interruptSession', () => {
  it('interrupts a local shell through the backend and announces it', async () => {
    const heard = vi.fn()
    window.addEventListener('omniterm:terminal-interrupted', heard)
    interruptSession(info('a'))
    await Promise.resolve()
    expect(connect.interruptSession).toHaveBeenCalledWith('a')
    expect(connect.localInput).not.toHaveBeenCalled()
    expect(heard).toHaveBeenCalledOnce()
    window.removeEventListener('omniterm:terminal-interrupted', heard)
  })

  it('types Ctrl+C when the backend interrupt fails, and into SSH sessions', async () => {
    connect.interruptSession.mockReturnValueOnce(Promise.reject(new Error('unsupported')))
    interruptSession(info('a'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(connect.localInput).toHaveBeenCalledWith('a', '\x03')
    interruptSession(info('s', { connType: 'SSH' }))
    expect(connect.sshInput).toHaveBeenCalledWith('s', '\x03')
  })
})

describe('registerSessionTabMenu', () => {
  it('adds the items to session tabs only', () => {
    publish(info('a'))
    registerSessionTabMenu()
    const calls = mocks.registerMenuGroup.mock.calls as unknown as Array<[{ menus: string[]; items: (menu: string, ctx: unknown) => MenuItem[] }]>
    const group = calls[0]![0]
    expect(group.menus).toEqual(['editorTab'])
    expect(labels(group.items('editorTab', { input: sessionInput('a') }))).toContain('Clear Terminal')
    expect(group.items('editorTab', { input: { kind: 'file', key: 'file:x' } })).toEqual([])
  })
})
