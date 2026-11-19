import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { fetchStatusLine, parseStatusLineText, statusLineDisplay } from './agentStatusLine'

describe('agent status line', () => {
  it('drops colours, links and control characters and joins the rows', () => {
    expect(statusLineDisplay('\x1b[1;34mOpus\x1b[0m │ \x1b]8;;file:///d\x1b\\D:/w\x1b]8;;\x1b\\\r\n\n  5h\t42%  \n')).toBe('Opus │ D:/w · 5h 42%')
    expect(statusLineDisplay('\x1b[0m\n \n')).toBe('')
  })

  it('accepts only a non-blank string from the backend', () => {
    expect(parseStatusLineText('a')).toBe('a')
    expect(parseStatusLineText(' ')).toBeNull()
    expect(parseStatusLineText(null)).toBeNull()
    expect(parseStatusLineText(5)).toBeNull()
    expect(parseStatusLineText('x'.repeat(3000))).toHaveLength(2000)
  })

  it('asks the backend for one conversation and treats a failure as no status line', async () => {
    invoke.mockResolvedValueOnce('line')
    await expect(fetchStatusLine('C:/p', 'id')).resolves.toBe('line')
    expect(invoke).toHaveBeenCalledWith('agent_quota_statusline_text', { profileDir: 'C:/p', sessionId: 'id' })
    invoke.mockRejectedValueOnce(new Error('off'))
    await expect(fetchStatusLine('C:/p', 'id')).resolves.toBeNull()
  })
})
