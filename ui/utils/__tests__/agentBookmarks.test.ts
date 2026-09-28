/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bindActiveSession,
  clearActiveForTab,
  clearStoredSessions,
  isBookmarkPending,
  loadStoredSessions,
  promoteStaleActiveSessions,
  requestPendingBookmark,
  setSessionBookmarked,
  upsertSession,
  type StoredAgentSession,
} from '../agentSessionStorage'
import { clearPins, loadPins, togglePin } from '../agentBookmarkPins'
import { hydrateAgentSessionStore, resetAgentSessionDurableForTests } from '../agentSessionDurable'
import { resumeCommandFor } from '../storedSessionResume'

const UUID = '12345678-1234-1234-1234-123456789abc'
const OTHER = '87654321-4321-4321-4321-cba987654321'
const DAY = 24 * 60 * 60 * 1000

function session(overrides: Partial<StoredAgentSession> = {}): StoredAgentSession {
  return {
    id: `claude:${UUID}`,
    tabId: 'tab-1',
    agent: 'claude',
    launcher: 'claude-work',
    profileName: 'claude-work',
    sessionId: UUID,
    cwd: 'D:/repo',
    folderName: 'repo',
    state: 'active',
    updatedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  resetAgentSessionDurableForTests()
  window.omnitermAPI = {} as typeof window.omnitermAPI
  clearStoredSessions()
  clearPins()
  localStorage.clear()
})

describe('bookmarks in the session store', () => {
  it('keeps a bookmark when the pane poll re-upserts the same session (regression)', () => {
    upsertSession(session())
    setSessionBookmarked(`claude:${UUID}`, true)

    // The 5 s poll knows nothing about bookmarks; it used to overwrite the entry as a plain `active`.
    bindActiveSession(session({ updatedAt: Date.now() + 5_000 }))

    expect(loadStoredSessions()[0]).toMatchObject({ state: 'active', bookmarked: true })
  })

  it('turns a bookmarked session into `saved` when its pane closes instead of deleting it (regression)', () => {
    upsertSession(session({ bookmarked: true }))
    clearActiveForTab('tab-1')

    const [entry] = loadStoredSessions()
    expect(entry).toMatchObject({ state: 'saved', bookmarked: true })
    expect(entry.tabId).toBeUndefined()
  })

  it('still drops an unbookmarked active session when its pane closes', () => {
    upsertSession(session())
    clearActiveForTab('tab-1')
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('exempts bookmarks from the 14-day expiry', () => {
    localStorage.setItem('omniterm:agent-sessions', JSON.stringify([
      session({ state: 'saved', bookmarked: true, updatedAt: Date.now() - 30 * DAY }),
      session({ id: `claude:${OTHER}`, sessionId: OTHER, state: 'interrupted', updatedAt: Date.now() - 30 * DAY }),
    ]))
    const list = loadStoredSessions()
    expect(list.map(item => item.sessionId)).toEqual([UUID])
  })

  it('applies a bookmark requested before the session id was known', () => {
    requestPendingBookmark('tab-1')
    expect(isBookmarkPending('tab-1')).toBe(true)

    bindActiveSession(session())

    expect(isBookmarkPending('tab-1')).toBe(false)
    expect(loadStoredSessions()[0].bookmarked).toBe(true)
  })

  it('releases the previous session bound to a tab when a new one takes over', () => {
    upsertSession(session({ bookmarked: true }))
    bindActiveSession(session({ id: `claude:${OTHER}`, sessionId: OTHER }))

    const byId = Object.fromEntries(loadStoredSessions().map(item => [item.sessionId, item]))
    expect(byId[UUID]).toMatchObject({ state: 'saved', bookmarked: true })
    expect(byId[OTHER]).toMatchObject({ state: 'active', tabId: 'tab-1' })
  })

  it('forgets a saved session once its bookmark is removed', () => {
    upsertSession(session({ state: 'saved', bookmarked: true, tabId: undefined }))
    setSessionBookmarked(`claude:${UUID}`, false)
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('keeps the bookmark flag through startup promotion', () => {
    upsertSession(session({ bookmarked: true }))
    promoteStaleActiveSessions()
    expect(loadStoredSessions()[0]).toMatchObject({ state: 'interrupted', bookmarked: true })
  })

  it('treats a legacy `saved` entry as bookmarked', () => {
    localStorage.setItem('omniterm:agent-sessions', JSON.stringify([session({ state: 'saved', tabId: undefined })]))
    expect(loadStoredSessions()[0].bookmarked).toBe(true)
  })
})

describe('crash-safe store', () => {
  it('restores an interrupted session from the file when localStorage lost it (hard kill)', async () => {
    const startedAt = Date.now()
    const fromFile = session({ updatedAt: startedAt - 1_000 })
    window.omnitermAPI = {
      agentSessions: {
        loadStore: vi.fn().mockResolvedValue({ version: 1, sessions: [fromFile], pins: [] }),
        saveStore: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.omnitermAPI

    await hydrateAgentSessionStore()

    // Still `active` in the file (the app died mid-run), so it comes back resumable.
    expect(loadStoredSessions()[0]).toMatchObject({ sessionId: UUID, state: 'interrupted' })
  })

  it('never writes the file before it has been read', async () => {
    const saveStore = vi.fn().mockResolvedValue(undefined)
    let resolveLoad: (doc: unknown) => void = () => {}
    window.omnitermAPI = {
      agentSessions: { loadStore: () => new Promise(resolve => { resolveLoad = resolve }), saveStore },
    } as unknown as typeof window.omnitermAPI

    const hydrating = hydrateAgentSessionStore()
    upsertSession(session())
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(saveStore).not.toHaveBeenCalled()

    resolveLoad({ version: 1, sessions: [], pins: [] })
    await hydrating
    await vi.waitFor(() => expect(saveStore).toHaveBeenCalled())
    expect(saveStore.mock.calls[0][0].sessions).toHaveLength(1)
  })

  it('rejects forged entries from the file', async () => {
    window.omnitermAPI = {
      agentSessions: {
        loadStore: vi.fn().mockResolvedValue({ sessions: [session({ sessionId: 'rm -rf /' })], pins: [{ id: 'x', agent: 'claude', profileName: 'p', cwd: 'D:/x', launcher: 'evil; cmd', createdAt: 1 }] }),
        saveStore: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.omnitermAPI

    await hydrateAgentSessionStore()

    expect(loadStoredSessions()).toHaveLength(0)
    expect(loadPins()).toHaveLength(0)
  })
})

describe('workspace pins', () => {
  it('toggles one pin per profile and folder, case-insensitively', () => {
    togglePin({ agent: 'claude', profileName: 'claude-work', launcher: 'claude-work', cwd: 'D:/Repo', folderName: 'Repo' })
    expect(loadPins()).toHaveLength(1)
    togglePin({ agent: 'claude', profileName: 'claude-work', cwd: 'd:/repo/' })
    expect(loadPins()).toHaveLength(0)
  })
})

describe('multi-agent bookmarks and resume commands', () => {
  it('bookmarks and resumes sessions for Codex, Antigravity CLI, Gemini CLI, and OpenCode', () => {
    const agySession = session({
      id: `agy:${UUID}`,
      agent: 'agy',
      launcher: 'agy-work',
      profileName: 'work',
      sessionId: UUID,
    })
    const agyDefaultSession = session({
      id: `agy:default-${UUID}`,
      agent: 'agy',
      launcher: 'agy-gemini',
      profileName: 'gemini',
      sessionId: UUID,
    })
    const codexSession = session({
      id: `codex:${UUID}`,
      agent: 'codex',
      launcher: 'codex-team',
      profileName: 'team',
      sessionId: UUID,
    })
    const opencodeSession = session({
      id: 'opencode:ses_abc123xyz',
      agent: 'opencode',
      launcher: undefined,
      profileName: 'opencode',
      sessionId: 'ses_abc123xyz',
    })
    const geminiSession = session({
      id: `gemini:${UUID}`,
      agent: 'gemini',
      launcher: undefined,
      profileName: 'gemini',
      sessionId: UUID,
    })

    upsertSession(agySession)
    upsertSession(agyDefaultSession)
    upsertSession(codexSession)
    upsertSession(opencodeSession)
    upsertSession(geminiSession)

    setSessionBookmarked(`agy:${UUID}`, true)
    setSessionBookmarked(`agy:default-${UUID}`, true)
    setSessionBookmarked(`codex:${UUID}`, true)
    setSessionBookmarked('opencode:ses_abc123xyz', true)
    setSessionBookmarked(`gemini:${UUID}`, true)

    const stored = loadStoredSessions()
    expect(stored.filter(s => s.bookmarked)).toHaveLength(5)

    expect(resumeCommandFor(agySession)).toBe(`agy-work --conversation ${UUID}`)
    expect(resumeCommandFor(agyDefaultSession)).toBe(`agy --conversation ${UUID}`)
    expect(resumeCommandFor(codexSession)).toBe(`codex-team resume ${UUID}`)
    expect(resumeCommandFor(opencodeSession)).toBe('opencode --session ses_abc123xyz')
    expect(resumeCommandFor(geminiSession)).toBe(`gemini --resume ${UUID}`)
  })
})

