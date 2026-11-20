import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  tabs: { panes: {} as Record<string, { id: string; tabs: Array<{ id: string; input: { key: string } }> }>, activePane: 'p1' },
  live: new Set<string>(),
  handler: null as null | { accepts: (type: string) => boolean; drop: (arg: { payload: string }) => void },
  moveTab: vi.fn(),
  activate: vi.fn(),
  openInput: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../../../diag', () => ({ diag: { warn: (...args: unknown[]) => state.warn(...args), error: vi.fn(), log: vi.fn(), info: vi.fn() } }))
vi.mock('../../../ide/editor/core/controller', () => ({
  useTabs: { getState: () => state.tabs },
  editorController: () => ({ moveTab: state.moveTab, activate: state.activate }),
}))
vi.mock('../../../ide/workbench/contributions', () => ({
  registerEditorDropHandler: (handler: typeof state.handler) => {
    state.handler = handler
    return () => { state.handler = null }
  },
  editorService: () => ({ openInput: state.openInput }),
}))
vi.mock('../sessionBridge', () => ({ sessionById: (id: string) => (state.live.has(id) ? { id } : undefined) }))
vi.mock('../sessionInput', () => ({
  sessionInput: (id: string) => ({ key: `session:${id}`, id }),
  parseSessionInput: (input: unknown) => {
    const id = (input as { id?: string } | undefined)?.id
    return typeof id === 'string' ? id : null
  },
}))

import { registerSessionDropHandler, SESSION_DRAG, sessionFromDrag } from '../sessionDrag'

describe('session drag and drop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.live = new Set(['s1'])
    state.tabs = {
      panes: {
        p1: { id: 'p1', tabs: [{ id: 't0', input: { key: 'file:a' } }] },
        p2: { id: 'p2', tabs: [{ id: 't1', input: { key: 'session:s1' } }] },
      },
      activePane: 'p1',
    }
  })

  it('accepts only ids of live sessions', () => {
    expect(sessionFromDrag('s1')).toBe('s1')
    expect(sessionFromDrag('ghost')).toBeNull()
  })

  it('registers a handler for the session drag type and removes it again', () => {
    const stop = registerSessionDropHandler()
    expect(state.handler?.accepts(SESSION_DRAG)).toBe(true)
    expect(state.handler?.accepts('text/plain')).toBe(false)
    stop()
    expect(state.handler).toBeNull()
  })

  it('moves the session tab into the active pane', () => {
    registerSessionDropHandler()
    state.handler?.drop({ payload: 's1' })
    expect(state.moveTab).toHaveBeenCalledWith('p2', 't1', 'p1', 1)
  })

  it('only activates a session tab that is already in the active pane', () => {
    state.tabs.activePane = 'p2'
    registerSessionDropHandler()
    state.handler?.drop({ payload: 's1' })
    expect(state.activate).toHaveBeenCalledWith('p2', 't1')
    expect(state.moveTab).not.toHaveBeenCalled()
  })

  it('opens a session that has no tab yet, and logs when that fails', async () => {
    state.tabs.panes.p2!.tabs = []
    state.openInput.mockResolvedValueOnce(undefined)
    registerSessionDropHandler()
    state.handler?.drop({ payload: 's1' })
    expect(state.openInput).toHaveBeenCalledWith({ key: 'session:s1', id: 's1' }, { focus: true })
    state.openInput.mockRejectedValueOnce(new Error('no pane'))
    state.handler?.drop({ payload: 's1' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.warn).toHaveBeenCalledWith('[sessions] could not open the dropped session', expect.any(Error))
  })

  it('ignores a payload that names no live session', () => {
    registerSessionDropHandler()
    state.handler?.drop({ payload: 'ghost' })
    expect(state.moveTab).not.toHaveBeenCalled()
    expect(state.openInput).not.toHaveBeenCalled()
  })
})
