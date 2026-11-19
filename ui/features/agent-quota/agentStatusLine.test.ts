import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { fetchStatusLine, parseStatusLine, statusLineDisplay } from './agentStatusLine'

describe('agent status line', () => {
  it('drops colours, links and control characters and joins the rows', () => {
    expect(statusLineDisplay('\x1b[1;34mOpus\x1b[0m │ \x1b]8;;file:///d\x1b\\D:/w\x1b]8;;\x1b\\\r\n\n  5h\t42%  \n')).toBe('Opus │ D:/w · 5h 42%')
    expect(statusLineDisplay('\x1b[0m\n \n')).toBe('')
  })

  it('accepts only a record with non-blank text from the backend', () => {
    expect(parseStatusLine({ text: 'a', contextPct: 31.5 })).toEqual({ text: 'a', contextPct: 31.5 })
    expect(parseStatusLine({ text: 'a' })).toEqual({ text: 'a', contextPct: null })
    expect(parseStatusLine({ text: 'a', contextPct: 140 })).toEqual({ text: 'a', contextPct: 100 })
    expect(parseStatusLine({ text: 'a', contextPct: '12' })?.contextPct).toBeNull()
    expect(parseStatusLine({ text: ' ' })).toBeNull()
    expect(parseStatusLine('a')).toBeNull()
    expect(parseStatusLine(null)).toBeNull()
    expect(parseStatusLine([])).toBeNull()
    expect(parseStatusLine({ text: 'x'.repeat(3000) })?.text).toHaveLength(2000)
  })

  it('asks the backend for one conversation and treats a failure as no status line', async () => {
    invoke.mockResolvedValueOnce({ text: 'line', contextPct: 9 })
    await expect(fetchStatusLine('C:/p', 'id')).resolves.toEqual({ text: 'line', contextPct: 9 })
    expect(invoke).toHaveBeenCalledWith('agent_quota_statusline_text', { profileDir: 'C:/p', sessionId: 'id' })
    invoke.mockRejectedValueOnce(new Error('off'))
    await expect(fetchStatusLine('C:/p', 'id')).resolves.toBeNull()
  })
})
