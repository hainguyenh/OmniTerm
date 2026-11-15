import { describe, expect, it } from 'vitest'

import type { StoredAgentSession } from '../../../utils/agentSessionStorage'
import {
  distinctValues,
  filterCleanupRows,
  formatAge,
  formatBytes,
  mergeCleanupRows,
  parseSessionFile,
  projectName,
  sortCleanupRows,
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

  it('formats sizes, ages, project names and distinct values', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(50 * 1024 * 1024)]).toEqual(['512 B', '2.0 KB', '50 MB'])
    const ages = [NOW, NOW - 5 * 60_000, NOW - 3 * 3_600_000, NOW - DAY, NOW - 9 * DAY].map((at) => formatAge(at, NOW))
    expect(ages).toEqual(['just now', '5 min ago', '3 h ago', '1 day ago', '9 days ago'])
    expect([projectName('D:\\work\\app\\'), projectName(undefined)]).toEqual(['app', ''])
    const rows = mergeCleanupRows([file({}), file({ id: 'x', sessionId: 'x', profile: 'a' })], [], NOW)
    expect(distinctValues(rows, (row) => row.profile)).toEqual(['a', 'claude'])
  })
})
