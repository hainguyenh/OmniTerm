/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryBackend } from '../../ide/editor/core/backend'
import { EditorController, useTabs } from '../../ide/editor/core/controller'
import { initialTabsState } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'
import {
  provideEditorService,
  useContributions,
  provideNotificationService,
  type EditorInput,
} from '../../ide/workbench/contributions'
import { resetSessionBridge, useSessionBridge, type SessionBridgeApi, type SessionInfo } from '../sessions/sessionBridge'
import {
  UNDO_CLOSE_MS,
  answerCloseConfirm,
  closeSessionFromEvent,
  closeSessionTabWithUndo,
  closeTabSilently,
  confirmSessionClose,
  resetSessionClose,
  useCloseConfirm,
} from '../sessions/sessionClose'
import { SESSION_KIND, sessionInput } from '../sessions/sessionInput'
import { registerSessionKind } from '../sessions/registerSessionKind'
import { dockSession, isDocked, resetTerminalDock } from '../terminalDock/terminalDockStore'

const holder = vi.hoisted(() => ({ controller: null as unknown }))
vi.mock('../../ide/editor/core/controller', async (original) => ({
  ...(await original<object>()),
  editorController: () => holder.controller,
}))

let controller: EditorController
let unregister: () => void
const notify = vi.fn()
const api: SessionBridgeApi = {
  killSession: vi.fn(),
  newSessionLike: vi.fn(),
  reconnect: vi.fn(),
  skipConfirm: vi.fn(() => false),
  setSkipConfirm: vi.fn(),
}

const info = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  connId: id,
  name: `Shell ${id}`,
  connType: 'LOCAL',
  workspaceId: null,
  status: 'connected',
  busy: false,
  cwd: null,
  hasCommand: false,
  ...over,
})
const publish = (...sessions: SessionInfo[]) => useSessionBridge.setState({ sessions, api, restoreSettled: true })
const tabKeys = () => Object.values(useTabs.getState().panes).flatMap((pane) => pane.tabs.map((tab) => tab.input.key))
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))
const settle = async () => {
  await vi.advanceTimersByTimeAsync(20)
}

beforeEach(() => {
  controller = new EditorController(createMemoryBackend({}))
  holder.controller = controller
  controller.start()
  unregister = registerSessionKind()
  provideNotificationService({ notify })
  provideEditorService({ openInput: (input: EditorInput) => controller.openInput(input) } as never)
  vi.mocked(api.skipConfirm).mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
  unregister()
  controller.stop()
  useTabs.setState(initialTabsState(), true)
  useProject.setState({ project: null, opening: false } as never)
  resetSessionBridge()
  resetSessionClose()
  resetTerminalDock()
  vi.clearAllMocks()
})

describe('session editor kind', () => {
  it('kills an idle session when its tab closes, without asking', async () => {
    publish(info('a'))
    await controller.openInput(sessionInput('a'))
    expect(await controller.closeInput('session:a')).toBe(true)
    expect(api.killSession).toHaveBeenCalledExactlyOnceWith('a')
    expect(useCloseConfirm.getState().request).toBeNull()
  })

  it('asks before closing a busy session, and Cancel keeps tab and session', async () => {
    publish(info('a', { busy: true }))
    await controller.openInput(sessionInput('a'))
    const closing = controller.closeInput('session:a')
    await flush()
    expect(useCloseConfirm.getState().request).toMatchObject({ multiple: false })
    answerCloseConfirm(false)
    expect(await closing).toBe(false)
    expect(tabKeys()).toEqual(['session:a'])
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('kills a busy session after Close Anyway, and remembers Do not ask again', async () => {
    publish(info('a', { busy: true }))
    await controller.openInput(sessionInput('a'))
    const closing = controller.closeInput('session:a')
    await flush()
    answerCloseConfirm(true, true)
    expect(await closing).toBe(true)
    expect(api.setSkipConfirm).toHaveBeenCalledOnce()
    expect(api.killSession).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('does not ask when the user turned asking off, nor for sessions that are not running', async () => {
    vi.mocked(api.skipConfirm).mockReturnValue(true)
    publish(info('a', { busy: true }), info('b', { status: 'closed' }))
    expect(await confirmSessionClose([sessionInput('a')])).toBe(true)
    vi.mocked(api.skipConfirm).mockReturnValue(false)
    expect(await confirmSessionClose([sessionInput('b'), sessionInput('unknown')])).toBe(true)
    expect(useCloseConfirm.getState().request).toBeNull()
  })

  it('asks once for several busy sessions (Close Others)', async () => {
    publish(info('a', { busy: true }), info('b', { status: 'connecting' }), info('c'))
    const asking = confirmSessionClose([sessionInput('a'), sessionInput('b'), sessionInput('c')])
    await flush()
    expect(useCloseConfirm.getState().request).toMatchObject({ multiple: true })
    answerCloseConfirm(true)
    expect(await asking).toBe(true)
  })

  it('closes a tab silently without killing or asking', async () => {
    publish(info('a', { busy: true }))
    await controller.openInput(sessionInput('a'))
    await closeTabSilently('a')
    expect(tabKeys()).toEqual([])
    expect(api.killSession).not.toHaveBeenCalled()
    expect(useCloseConfirm.getState().request).toBeNull()
  })

  it('is never evicted by the tab limit', async () => {
    useProject.setState({ settings: { editor: { tabs: { tabLimit: 2 } } } } as never)
    publish(info('a'), info('b'), info('c'), info('d'))
    for (const id of ['a', 'b', 'c', 'd']) await controller.openInput(sessionInput(id))
    await flush()
    expect(tabKeys()).toHaveLength(4)
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('titles tabs from the session registry and saves only the session id', () => {
    publish(info('a', { name: 'claude // repo' }))
    const kind = useContributions.getState().editorKinds.get(SESSION_KIND)!
    expect(kind.title(sessionInput('a'))).toBe('claude // repo')
    expect(kind.title(sessionInput('gone'))).toBe('Terminal')
    expect(kind.title({ kind: SESSION_KIND, key: 'bad' })).toBe('Terminal')
    expect(kind).toMatchObject({ restorable: true, keepAlive: true, exemptFromTabLimit: true })
  })
})

describe('double Ctrl+C', () => {
  beforeEach(() => vi.useFakeTimers())

  it('closes the tab at once without a prompt and kills the session after the undo window', async () => {
    publish(info('a', { busy: true }))
    await controller.openInput(sessionInput('a'))
    await settle()
    const closing = closeSessionTabWithUndo('a')
    await settle()
    await closing
    expect(tabKeys()).toEqual([])
    expect(useCloseConfirm.getState().request).toBeNull()
    expect(api.killSession).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Closed Shell a' }))
    vi.advanceTimersByTime(UNDO_CLOSE_MS + 10)
    expect(api.killSession).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('Undo reopens the tab and spares the session; an ended session is started again', async () => {
    publish(info('a', { status: 'closed' }))
    await controller.openInput(sessionInput('a'))
    await settle()
    const closing = closeSessionTabWithUndo('a')
    await settle()
    await closing
    const undo = notify.mock.calls[0]![0].actions[0] as { run: () => void }
    undo.run()
    await settle()
    expect(tabKeys()).toEqual(['session:a'])
    expect(api.reconnect).toHaveBeenCalledExactlyOnceWith('a')
    vi.advanceTimersByTime(UNDO_CLOSE_MS * 2)
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('takes a docked session out of the Terminal tool window, and Undo docks it again', async () => {
    publish(info('a'))
    dockSession('a')
    await closeSessionTabWithUndo('a')
    expect(isDocked('a')).toBe(false)
    expect(tabKeys()).toEqual([])
    const undo = notify.mock.calls[0]![0].actions[0] as { run: () => void }
    undo.run()
    expect(isDocked('a')).toBe(true)
    expect(tabKeys()).toEqual([])
    vi.advanceTimersByTime(UNDO_CLOSE_MS * 2)
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('kills a docked session after the undo window', async () => {
    publish(info('a'))
    dockSession('a')
    await closeSessionTabWithUndo('a')
    vi.advanceTimersByTime(UNDO_CLOSE_MS + 10)
    expect(api.killSession).toHaveBeenCalledExactlyOnceWith('a')
    expect(isDocked('a')).toBe(false)
  })

  it('routes the close-tab event: an id closes that session, none closes the active tab', async () => {
    publish(info('a'), info('b'))
    await controller.openInput(sessionInput('a'))
    await controller.openInput(sessionInput('b'))
    await settle()
    closeSessionFromEvent(undefined)
    await settle()
    expect(tabKeys()).toEqual(['session:a'])
    expect(api.killSession).toHaveBeenCalledExactlyOnceWith('b')
    closeSessionFromEvent('a')
    await settle()
    expect(tabKeys()).toEqual([])
  })
})
