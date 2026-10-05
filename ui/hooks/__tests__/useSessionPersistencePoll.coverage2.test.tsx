/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'

import { useSessionPersistence } from '../useSessionPersistence'
import { detectPaneAgents, resolveClaudeSessionId, type DetectedPaneAgent } from '../../utils/agentSessionDetector'
import { bindActiveSession, clearActiveForTab, findSessionByTabId } from '../../utils/agentSessionStorage'
import { getPanePresence, isInRestoreGrace, setPanePresence, type PanePresence } from '../../utils/agentPresenceStore'

vi.mock('../../utils/agentSessionDetector', () => ({
  detectPaneAgents: vi.fn(async () => []),
  resolveClaudeSessionId: vi.fn(async () => null),
}))

vi.mock('../../utils/agentSessionStorage', () => ({
  bindActiveSession: vi.fn(),
  clearActiveForTab: vi.fn(),
  findSessionByTabId: vi.fn(() => undefined),
  promoteStaleActiveSessions: vi.fn(),
}))

vi.mock('../../utils/agentSessionDurable', () => ({ hydrateAgentSessionStore: vi.fn(async () => {}) }))

vi.mock('../../utils/agentPresenceStore', () => ({
  getPanePresence: vi.fn(() => undefined),
  isInRestoreGrace: vi.fn(() => false),
  setPanePresence: vi.fn(),
}))

vi.mock('../../utils/sessionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/sessionStore')>()
  return { ...actual, loadSnapshot: vi.fn(() => null), saveSnapshot: vi.fn() }
})

const detectMock = vi.mocked(detectPaneAgents)
const resolveClaudeMock = vi.mocked(resolveClaudeSessionId)
const bindMock = vi.mocked(bindActiveSession)
const clearMock = vi.mocked(clearActiveForTab)
const findMock = vi.mocked(findSessionByTabId)
const presenceMock = vi.mocked(getPanePresence)
const graceMock = vi.mocked(isInRestoreGrace)
const setPresenceMock = vi.mocked(setPanePresence)

type Tab = { id: string; connId: string; name: string }

const conn = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'c', name: 'PowerShell', type: 'LOCAL', host: '', port: '', user: '', ...overrides,
})

const agent = (overrides: Partial<DetectedPaneAgent> = {}): DetectedPaneAgent => ({
  sessionId: 't1', agent: 'codex', pid: 10, startTime: 100, profileName: 'codex', subAgentCount: 0, ...overrides,
})

function setResolveModel(resolveModel?: (agentKind: string) => Promise<PanePresence['modelInfo'] | null>) {
  Object.defineProperty(window, 'omnitermAPI', {
    value: { agentSessions: resolveModel ? { resolveModel } : {} },
    configurable: true,
    writable: true,
  })
}

function renderPoll(tabs: Tab[], conns: Connection[] = [conn()], sessionCwds: Record<string, string> = {}) {
  return renderHook(() => useSessionPersistence({ activeTabs: tabs, ephemeralConns: conns, sessionCwds }))
}

const lastPresence = () => setPresenceMock.mock.calls.at(-1)?.[0]
const bound = () => bindMock.mock.calls.map(([session]) => session)

beforeEach(() => {
  vi.clearAllMocks()
  detectMock.mockResolvedValue([])
  resolveClaudeMock.mockResolvedValue(null)
  findMock.mockReturnValue(undefined)
  presenceMock.mockReturnValue(undefined)
  graceMock.mockReturnValue(false)
  setResolveModel()
})

afterEach(() => vi.useRealTimers())

describe('useSessionPersistence agent poll without a detected process', () => {
  it('does not scan while no tab is open', async () => {
    renderPoll([])
    await act(async () => {})
    expect(detectMock).not.toHaveBeenCalled()
  })

  it('untracks a plain pane unless it was just restored', async () => {
    graceMock.mockImplementation((tabId) => tabId === 'fresh')
    renderPoll([{ id: 'old', connId: 'c', name: 'pwsh' }, { id: 'fresh', connId: 'c', name: 'Aider' }])
    await waitFor(() => expect(setPresenceMock).toHaveBeenCalledWith({}))
    expect(clearMock).toHaveBeenCalledWith('old')
    expect(clearMock).not.toHaveBeenCalledWith('fresh')
    expect(bindMock).not.toHaveBeenCalled()
  })

  it('cannot track a Claude title without a known session id', async () => {
    renderPoll([{ id: 't1', connId: 'c', name: 'Claude Code' }])
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('t1'))
    expect(bindMock).not.toHaveBeenCalled()
  })

  it('keeps a Claude title bound to its stored session', async () => {
    findMock.mockReturnValue({ id: 'claude:s9', agent: 'claude', sessionId: 's9', profileName: 'work', launcher: 'claude-work', state: 'active', updatedAt: 1 })
    renderPoll([{ id: 't1', connId: 'c', name: 'Claude Code' }], [conn({ localCwd: 'C:\\code\\app\\' })])
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(bound()[0]).toMatchObject({
      id: 'claude:s9', tabId: 't1', agent: 'claude', launcher: 'claude-work', profileName: 'work',
      sessionId: 's9', cwd: 'C:\\code\\app\\', folderName: 'app', state: 'active',
    })
    expect(bound()[0]).not.toHaveProperty('title')
    expect(lastPresence()).toEqual({
      t1: { agent: 'claude', profileName: 'work', pid: 0, startTime: 0, agentSessionId: 's9', claudeSessionId: 's9' },
    })
  })

  it('tracks a non-Claude agent named by its connection as the latest session with its work item', async () => {
    renderPoll([{ id: 't1', connId: 'c', name: 'Fix login bug' }], [conn({ name: 'codex' })], { t1: '/home/me/repo' })
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(bound()[0]).toMatchObject({
      id: 'codex:codex-t1', agent: 'codex', profileName: 'codex', sessionId: 'latest',
      cwd: '/home/me/repo', folderName: 'repo', title: 'Fix login bug',
    })
    expect(lastPresence()?.t1).toEqual({ agent: 'codex', profileName: 'codex', pid: 0, startTime: 0, agentSessionId: 'latest' })
  })

  it('reads the agent from the launch command and reuses the previous presence', async () => {
    presenceMock.mockReturnValue({ agent: 'agy', profileName: 'agy-home', pid: 4, startTime: 5, claudeSessionId: 'kept' })
    renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }], [conn({ localCommand: 'agy' })])
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(bound()[0]).toMatchObject({ id: 'agy:kept', profileName: 'agy-home', sessionId: 'kept' })
    expect(bound()[0].cwd).toBeUndefined()
    expect(bound()[0].folderName).toBeUndefined()
    expect(lastPresence()?.t1).toEqual({ agent: 'agy', profileName: 'agy-home', pid: 4, startTime: 5, agentSessionId: 'kept' })
  })
})

describe('useSessionPersistence agent poll with a detected process', () => {
  it('resolves the Claude session file and model for a new process', async () => {
    const resolveModel = vi.fn(async () => ({ model: 'opus', display: 'Opus' }))
    setResolveModel(resolveModel)
    detectMock.mockResolvedValue([agent({ agent: 'claude', profileName: 'work', profileDir: 'C:/p', launcher: 'claude-work' })])
    resolveClaudeMock.mockResolvedValue('sid-1')
    renderPoll([{ id: 't1', connId: 'c', name: '✳ Refactor parser' }], [conn()], { t1: 'C:/repo' })
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(resolveModel).toHaveBeenCalledWith('claude', 'C:/p', 'C:/repo')
    expect(bound()[0]).toMatchObject({
      id: 'claude:sid-1', agent: 'claude', launcher: 'claude-work', profileName: 'work', sessionId: 'sid-1', title: 'Refactor parser',
    })
    expect(lastPresence()?.t1).toEqual({
      agent: 'claude', profileName: 'work', launcher: 'claude-work', pid: 10, startTime: 100,
      claudeSessionId: 'sid-1', agentSessionId: 'sid-1', modelInfo: { model: 'opus', display: 'Opus' },
    })
  })

  it('records presence but binds nothing while a Claude session file is not there yet', async () => {
    setResolveModel(async () => null)
    detectMock.mockResolvedValue([agent({ agent: 'claude', profileName: 'claude' })])
    renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(setPresenceMock).toHaveBeenCalled())
    expect(bindMock).not.toHaveBeenCalled()
    expect(lastPresence()?.t1).toEqual({ agent: 'claude', profileName: 'claude', pid: 10, startTime: 100 })
  })

  it('keeps the session id and model of the same process across polls', async () => {
    presenceMock.mockReturnValue({
      agent: 'codex', profileName: 'codex', pid: 10, startTime: 100, agentSessionId: 'abc', modelInfo: { model: 'gpt', display: 'GPT' },
    })
    detectMock.mockResolvedValue([agent()])
    renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(bound()[0]).toMatchObject({ id: 'codex:abc', sessionId: 'abc', launcher: undefined })
    expect(lastPresence()?.t1).toMatchObject({ agentSessionId: 'abc', modelInfo: { model: 'gpt', display: 'GPT' } })
  })

  it('treats a restarted process as new, dropping the old session id', async () => {
    presenceMock.mockReturnValue({ agent: 'codex', profileName: 'codex', pid: 10, startTime: 99, claudeSessionId: 'old' })
    detectMock.mockResolvedValue([agent()])
    renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(bindMock).toHaveBeenCalled())
    expect(bound()[0]).toMatchObject({ id: 'codex:codex-t1', sessionId: 'latest' })
  })

  it('derives the resume launcher from the profile the agent runs under', async () => {
    const cases: [Partial<DetectedPaneAgent>, string | undefined][] = [
      [{ launcher: 'agy-gemini', agent: 'agy' }, undefined],
      [{ launcher: 'codex-x' }, 'codex-x'],
      [{ profileName: '' }, undefined],
      [{ profileName: 'codex' }, undefined],
      [{ profileName: 'agy-gemini', agent: 'agy' }, undefined],
      [{ profileName: 'gemini', agent: 'agy' }, undefined],
      [{ profileName: 'codex-work' }, 'codex-work'],
      [{ profileName: 'work' }, 'codex-work'],
    ]
    const tabs = cases.map((_entry, index) => ({ id: `t${index}`, connId: 'c', name: 'pwsh' }))
    detectMock.mockResolvedValue(cases.map(([overrides], index) => agent({ sessionId: `t${index}`, ...overrides })))
    renderPoll(tabs)
    await waitFor(() => expect(bindMock).toHaveBeenCalledTimes(cases.length))
    expect(bound().map(session => session.launcher)).toEqual(cases.map(([, launcher]) => launcher))
  })
})

describe('useSessionPersistence agent poll lifecycle', () => {
  it('drops a scan that finishes after unmount', async () => {
    let finish: (value: DetectedPaneAgent[]) => void = () => {}
    detectMock.mockImplementation(() => new Promise((done) => { finish = done }))
    const { unmount } = renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(detectMock).toHaveBeenCalled())
    unmount()
    await act(async () => { finish([agent()]) })
    expect(setPresenceMock).not.toHaveBeenCalled()
  })

  it('drops a model lookup that finishes after unmount', async () => {
    let finish: (value: null) => void = () => {}
    const resolveModel = vi.fn(() => new Promise<null>((done) => { finish = done }))
    setResolveModel(resolveModel)
    detectMock.mockResolvedValue([agent()])
    const { unmount } = renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(resolveModel).toHaveBeenCalled())
    unmount()
    await act(async () => { finish(null) })
    expect(bindMock).not.toHaveBeenCalled()
    expect(setPresenceMock).not.toHaveBeenCalled()
  })

  it('drops a Claude session lookup that finishes after unmount', async () => {
    let finish: (value: string | null) => void = () => {}
    resolveClaudeMock.mockImplementation(() => new Promise((done) => { finish = done }))
    detectMock.mockResolvedValue([agent({ agent: 'claude', profileName: 'claude' })])
    const { unmount } = renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    await waitFor(() => expect(resolveClaudeMock).toHaveBeenCalled())
    unmount()
    await act(async () => { finish('late') })
    expect(bindMock).not.toHaveBeenCalled()
  })

  it('skips an interval tick while the previous scan is still running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let finish: (value: DetectedPaneAgent[]) => void = () => {}
    detectMock.mockImplementation(() => new Promise((done) => { finish = done }))
    const { unmount } = renderPoll([{ id: 't1', connId: 'c', name: 'pwsh' }])
    expect(detectMock).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(detectMock).toHaveBeenCalledTimes(1)
    await act(async () => { finish([]) })
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(detectMock).toHaveBeenCalledTimes(2)
    unmount()
  })
})
