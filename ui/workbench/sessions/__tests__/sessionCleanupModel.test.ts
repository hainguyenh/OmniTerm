import { describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

import type { StoredAgentSession } from '../../../utils/agentSessionStorage'
import {
  agentLabel,
  cancelSessionDelete,
  filterCleanupRows,
  formatAge,
  formatBytes,
  mergeCleanupRows,
  parseSessionFile,
  parseSessionProfile,
  listSessionFiles,
  profilesToScan,
  projectName,
  scanCoversAge,
  selectAllKeys,
  sortCleanupRows,
  withoutDeleted,
  type AgentSessionFile,
} from '../sessionCleanupModel'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

const file = (patch: Partial<AgentSessionFile>): AgentSessionFile => ({
  id: 'claude:claude:s1',
  agent: 'claude',
  profile: 'claude',
  sessionId: 's1',
  cwd: 'D:/work/app',
  title: 'Fix the build',
  lastActive: NOW - 40 * DAY,
  size: 2048,
  empty: false,
  ...patch,
})

const stored = (patch: Partial<StoredAgentSession>): StoredAgentSession => ({
  id: 'claude:s1',
  agent: 'claude',
  profileName: 'claude',
  sessionId: 's1',
  state: 'interrupted',
  updatedAt: NOW - 50 * DAY,
  ...patch,
}) as StoredAgentSession

describe('session cleanup model', () => {
  it('validates listing entries from the backend', () => {
    expect(parseSessionFile({ ...file({}) })).toEqual(file({}))
    expect(parseSessionFile({ ...file({}), agent: 'gemini' })).toBeNull()
    expect(parseSessionFile({ ...file({}), agent: 'agy' })).toMatchObject({ agent: 'agy' })
    expect(parseSessionFile({ ...file({}), agent: 'cursor' })).toBeNull()
    expect(parseSessionFile({ ...file({}), size: -1 })).toBeNull()
    expect(parseSessionFile({ ...file({}), cwd: 42, title: '' })).toMatchObject({ cwd: null, title: null })
    expect(parseSessionFile(null)).toBeNull()
  })

  it('joins files with remembered sessions and keeps remembered ones without a file', () => {
    const rows = mergeCleanupRows(
      [file({}), file({ id: 'codex:codex:s9', agent: 'codex', profile: 'codex', sessionId: 's9', cwd: null, title: null })],
      [stored({ title: 'Login bug', bookmarked: true }), stored({ id: 'claude:s2', sessionId: 's2', state: 'active', cwd: 'D:/x' })],
      NOW,
    )
    expect(rows.map((row) => [row.key, row.fileId, row.storedId, row.bookmarked, row.open, row.title])).toEqual([
      ['claude:claude:s1', 'claude:claude:s1', 'claude:s1', true, false, 'Login bug'],
      ['codex:codex:s9', 'codex:codex:s9', null, false, false, undefined],
      ['stored:claude:s2', null, 'claude:s2', false, true, undefined],
    ])
    expect(rows[2]?.size).toBeNull()
  })

  it('treats a transcript written moments ago as in use', () => {
    const [recent, idle] = mergeCleanupRows([file({ lastActive: NOW - 60_000 }), file({ id: 'b', sessionId: 'b' })], [], NOW)
    expect([recent?.open, idle?.open]).toEqual([true, false])
  })

  it('filters by agent, profile and idle time', () => {
    const rows = mergeCleanupRows([
      file({}),
      file({ id: 'claude:claude-work:s3', profile: 'claude-work', sessionId: 's3', lastActive: NOW - DAY / 2 }),
      file({ id: 'codex:codex:s4', agent: 'codex', profile: 'codex', sessionId: 's4' }),
    ], [], NOW)
    const keys = (filter: Parameters<typeof filterCleanupRows>[1]) => filterCleanupRows(rows, filter, NOW).map((row) => row.key)
    expect(keys({ agent: 'claude', profile: 'all', olderThanDays: 0 })).toEqual(['claude:claude:s1', 'claude:claude-work:s3'])
    expect(keys({ agent: 'all', profile: 'claude-work', olderThanDays: 0 })).toEqual(['claude:claude-work:s3'])
    expect(keys({ agent: 'all', profile: 'all', olderThanDays: 30 })).toEqual(['claude:claude:s1', 'codex:codex:s4'])
  })

  it('keeps only the conversations without a prompt when asked, and reads the flag from IPC', () => {
    const rows = mergeCleanupRows([
      file({}),
      file({ id: 'claude:claude:s2', sessionId: 's2', title: null, empty: true }),
    ], [{ id: 'claude:s9', agent: 'claude', profileName: 'claude', sessionId: 's9', state: 'saved', updatedAt: NOW - 40 * DAY } as StoredAgentSession], NOW)
    const keys = filterCleanupRows(rows, { agent: 'all', profile: 'all', olderThanDays: 0, emptyOnly: true }, NOW).map((row) => row.key)
    expect(keys).toEqual(['claude:claude:s2'])
    const raw = { id: 'claude:claude:s2', agent: 'claude', profile: 'claude', sessionId: 's2', lastActive: 1, size: 187 }
    expect(parseSessionFile({ ...raw, empty: true })?.empty).toBe(true)
    expect(parseSessionFile({ ...raw, empty: 'yes' })?.empty).toBe(false)
    expect(parseSessionFile(raw)?.empty).toBe(false)
  })

  it('sorts by last active by default and by any column both ways', () => {
    const rows = mergeCleanupRows([
      file({ id: 'a', sessionId: 'a', lastActive: 3, size: 10, profile: 'b', cwd: 'C:/zeta' }),
      file({ id: 'b', sessionId: 'b', lastActive: 9, size: 30, profile: 'a', cwd: 'C:/alpha/' }),
      file({ id: 'c', sessionId: 'c', lastActive: 5, size: 20, profile: 'a', cwd: null }),
    ], [], NOW)
    const keys = (column: Parameters<typeof sortCleanupRows>[1]['column'], descending: boolean) =>
      sortCleanupRows(rows, { column, descending }).map((row) => row.key)
    expect(keys('lastActive', true)).toEqual(['b', 'c', 'a'])
    expect(keys('size', false)).toEqual(['a', 'c', 'b'])
    expect(keys('profile', false)).toEqual(['b', 'c', 'a'])
    expect(keys('project', false)).toEqual(['c', 'b', 'a'])
  })

  it('formats sizes, ages and project names', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(50 * 1024 * 1024)]).toEqual(['512 B', '2.0 KB', '50 MB'])
    const ages = [NOW, NOW - 5 * 60_000, NOW - 3 * 3_600_000, NOW - DAY, NOW - 9 * DAY].map((at) => formatAge(at, NOW))
    expect(ages).toEqual(['just now', '5 min ago', '3 h ago', '1 day ago', '9 days ago'])
    expect([projectName('D:\\work\\app\\'), projectName(undefined)]).toEqual(['app', ''])
  })
  it('scans the chosen profile, else every profile of the chosen agent', () => {
    const profiles = [
      { agent: 'claude' as const, profile: 'claude' },
      { agent: 'claude' as const, profile: 'claude-work' },
      { agent: 'codex' as const, profile: 'codex' },
    ]
    expect(profilesToScan(profiles, { agent: 'all', profile: 'all' })).toEqual(['claude', 'claude-work', 'codex'])
    expect(profilesToScan(profiles, { agent: 'claude', profile: 'all' })).toEqual(['claude', 'claude-work'])
    expect(profilesToScan(profiles, { agent: 'claude', profile: 'claude-work' })).toEqual(['claude-work'])
    expect([
      parseSessionProfile({ agent: 'claude', profile: 'claude' }),
      parseSessionProfile({ agent: 'agy', profile: 'antigravity-cli' }),
      parseSessionProfile({ agent: 'cursor', profile: 'x' }),
    ]).toEqual([{ agent: 'claude', profile: 'claude' }, { agent: 'agy', profile: 'antigravity-cli' }, null])
  })

  it('names every agent the backend lists', () => {
    expect(['claude', 'codex', 'agy', 'gemini'].map(agentLabel)).toEqual(['Claude', 'Codex', 'Antigravity', 'gemini'])
  })

  it('selects every selectable row, drawn or not, and clears', () => {
    const rows = mergeCleanupRows([file({}), file({ id: 'b', sessionId: 'b', lastActive: NOW })], [], NOW)
    expect([...selectAllKeys(rows, true)]).toEqual(['claude:claude:s1'])
    expect(selectAllKeys(rows, false).size).toBe(0)
  })

  it('drops the deleted conversations from the listing and keeps the rest in order', () => {
    const files = [file({ id: 'a' }), file({ id: 'b' }), file({ id: 'c' })]
    expect(withoutDeleted(files, ['b', 'x']).map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('asks the backend to stop a delete and ignores a delete that has already ended', async () => {
    invokeMock.mockRejectedValueOnce(new Error('not running'))
    await expect(cancelSessionDelete()).resolves.toBeUndefined()
    expect(invokeMock).toHaveBeenCalledWith('agent_session_files_delete_cancel')
  })
})

describe('the idle age of a scan', () => {
  it('sends the age to the backend so old sessions survive its listing cap', async () => {
    invokeMock.mockResolvedValue([])
    await listSessionFiles(['claude'], 7)
    expect(invokeMock).toHaveBeenCalledWith('agent_session_files_list', { profiles: ['claude'], olderThanDays: 7 })
  })

  it('covers only filters at least as old as the scan', () => {
    expect(scanCoversAge(7, 7)).toBe(true)
    expect(scanCoversAge(7, 30)).toBe(true)
    expect(scanCoversAge(7, 0)).toBe(false)
    expect(scanCoversAge(0, 7)).toBe(true)
  })
})
