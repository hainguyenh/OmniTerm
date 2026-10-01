/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPanePresenceForTests, setPanePresence } from '../agentPresenceStore'
import { clearStoredSessions, upsertSession } from '../agentSessionStorage'
import { dispatchTerminalSave, type TerminalBufferLike } from '../terminalCopyExtract'
import { registerTerminalSaveExport, resolveSaveExport } from '../terminalSaveExport'

const CLAUDE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const buffer = (lines: string[]): TerminalBufferLike => ({
  active: {
    length: lines.length,
    viewportY: 0,
    getLine: (index) => ({ translateToString: () => lines[index] ?? '' }),
  },
})

const claudeRow = { sessionId: 'pane-1', agent: 'claude', pid: 10, startTime: 1, profileDir: 'C:/profiles/work', profileName: 'claude-work', subAgentCount: 0 }

type ExportTranscript = (profileDir: string, sessionId: string) => Promise<string | null>

function installApi(detect: unknown[], exportClaudeTranscript = vi.fn<ExportTranscript>(async () => '# Claude Code conversation\n\n## User\n\nFull history\n')) {
  const exportText = vi.fn(async () => true)
  const resolveClaudeSession = vi.fn(async () => null)
  Object.assign(window, {
    omnitermAPI: {
      agentSessions: { detect: vi.fn(async () => detect), resolveClaudeSession, exportClaudeTranscript },
      files: { exportText },
    },
  })
  return { exportClaudeTranscript, exportText, resolveClaudeSession }
}

beforeEach(() => {
  localStorage.clear()
  clearStoredSessions()
  resetPanePresenceForTests()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'omnitermAPI')
})

describe('resolveSaveExport', () => {
  it('prefers the whole Claude conversation for a Claude pane', async () => {
    const { exportClaudeTranscript } = installApi([claudeRow])
    setPanePresence({ 'pane-1': { agent: 'claude', profileName: 'claude-work', pid: 10, startTime: 1, claudeSessionId: CLAUDE_ID } })

    const saved = await resolveSaveExport('pane-1', buffer(['only the tail']))

    expect(exportClaudeTranscript).toHaveBeenCalledWith('C:/profiles/work', CLAUDE_ID)
    expect(saved).toEqual({ suggestedName: 'claude-conversation-0f8fad5b.txt', content: expect.stringContaining('Full history') })
  })

  it('uses the stored session id when presence has none', async () => {
    const { exportClaudeTranscript } = installApi([claudeRow])
    upsertSession({ id: `claude:${CLAUDE_ID}`, tabId: 'pane-1', agent: 'claude', profileName: 'claude-work', sessionId: CLAUDE_ID, state: 'active', updatedAt: Date.now() })

    await resolveSaveExport('pane-1', buffer(['tail']))

    expect(exportClaudeTranscript).toHaveBeenCalledWith('C:/profiles/work', CLAUDE_ID)
  })

  it('falls back to the terminal buffer for a pane without a Claude agent', async () => {
    const { exportClaudeTranscript } = installApi([{ ...claudeRow, agent: 'codex' }])

    const saved = await resolveSaveExport('pane-1', buffer(['$ ls', 'file.txt', '']))

    expect(exportClaudeTranscript).not.toHaveBeenCalled()
    expect(saved).toEqual({ suggestedName: 'terminal-output.txt', content: '$ ls\nfile.txt' })
  })

  it('falls back to the buffer when the session id is unknown or not a UUID', async () => {
    const { exportClaudeTranscript } = installApi([claudeRow])
    setPanePresence({ 'pane-1': { agent: 'claude', profileName: 'claude-work', pid: 10, startTime: 1, agentSessionId: 'latest' } })

    const saved = await resolveSaveExport('pane-1', buffer(['tail']))

    expect(exportClaudeTranscript).not.toHaveBeenCalled()
    expect(saved?.content).toBe('tail')
  })

  it('falls back to the buffer when the transcript export is empty or fails', async () => {
    installApi([claudeRow], vi.fn<ExportTranscript>(async () => null))
    setPanePresence({ 'pane-1': { agent: 'claude', profileName: 'claude-work', pid: 10, startTime: 1, claudeSessionId: CLAUDE_ID } })

    expect((await resolveSaveExport('pane-1', buffer(['tail'])))?.suggestedName).toBe('terminal-output.txt')
  })

  it('returns null when there is nothing to save', async () => {
    installApi([])
    expect(await resolveSaveExport('pane-1', buffer(['', '']))).toBeNull()
  })
})

describe('registerTerminalSaveExport', () => {
  it('writes the resolved export for its own session only', async () => {
    const { exportText } = installApi([claudeRow])
    setPanePresence({ 'pane-1': { agent: 'claude', profileName: 'claude-work', pid: 10, startTime: 1, claudeSessionId: CLAUDE_ID } })
    const dispose = registerTerminalSaveExport({ sessionId: 'pane-1', isCurrent: () => true, buffer: buffer(['tail']) })

    dispatchTerminalSave('pane-2')
    dispatchTerminalSave('pane-1')
    await vi.waitFor(() => expect(exportText).toHaveBeenCalledTimes(1))
    expect(exportText).toHaveBeenCalledWith({ suggestedName: 'claude-conversation-0f8fad5b.txt', content: expect.stringContaining('Full history') })

    dispose()
    dispatchTerminalSave('pane-1')
    await Promise.resolve()
    expect(exportText).toHaveBeenCalledTimes(1)
  })

  it('ignores requests once the pane was replaced', async () => {
    const { exportText } = installApi([])
    const dispose = registerTerminalSaveExport({ sessionId: 'pane-1', isCurrent: () => false, buffer: buffer(['tail']) })

    dispatchTerminalSave('pane-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(exportText).not.toHaveBeenCalled()
    dispose()
  })
})
