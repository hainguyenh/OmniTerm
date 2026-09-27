import { describe, expect, it } from 'vitest'

import type { AgentWorkspacePin } from '../agentBookmarkPins'
import type { StoredAgentSession } from '../agentSessionStorage'
import { filterPins, groupBookmarks } from '../bookmarkGroups'

let n = 0
function session(overrides: Partial<StoredAgentSession>): StoredAgentSession {
  n += 1
  const sessionId = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  return {
    id: `claude:${sessionId}`,
    agent: 'claude',
    profileName: 'claude-work',
    sessionId,
    cwd: 'D:/repo',
    folderName: 'repo',
    state: 'saved',
    bookmarked: true,
    updatedAt: n,
    ...overrides,
  }
}

const pin: AgentWorkspacePin = {
  id: 'claude-work|d:/repo', agent: 'claude', profileName: 'claude-work', cwd: 'D:/repo', folderName: 'repo', createdAt: 1,
}

describe('groupBookmarks', () => {
  it('lists bookmarks and interrupted sessions, but not plain running ones', () => {
    const groups = groupBookmarks([
      session({ title: 'saved one' }),
      session({ state: 'interrupted', bookmarked: undefined, title: 'crashed' }),
      session({ state: 'active', bookmarked: undefined, title: 'just running' }),
      session({ state: 'active', bookmarked: true, title: 'running bookmark' }),
    ], [])
    const titles = groups.flatMap(group => group.folders.flatMap(folder => folder.sessions.map(item => item.title)))
    expect(titles.sort()).toEqual(['crashed', 'running bookmark', 'saved one'])
  })

  it('groups by profile, then folder; pinned folders first, newest sessions first', () => {
    const groups = groupBookmarks([
      session({ profileName: 'claude-home', cwd: 'C:/home', folderName: 'home' }),
      session({ cwd: 'D:/other', folderName: 'other' }),
      session({ title: 'older' }),
      session({ title: 'newer' }),
    ], [pin])
    expect(groups.map(group => group.profileName)).toEqual(['claude-home', 'claude-work'])
    const work = groups[1]
    expect(work.folders.map(folder => folder.folderName)).toEqual(['repo', 'other'])
    expect(work.folders[0].pinned).toBe(true)
    expect(work.folders[0].sessions.map(item => item.title)).toEqual(['newer', 'older'])
  })

  it('filters by title, folder and profile', () => {
    const sessions = [session({ title: 'Fix header' }), session({ title: 'Resume bug', cwd: 'D:/api', folderName: 'api' })]
    expect(groupBookmarks(sessions, [], 'header')[0].folders[0].sessions).toHaveLength(1)
    expect(groupBookmarks(sessions, [], 'API')[0].folders[0].folderName).toBe('api')
    expect(groupBookmarks(sessions, [], 'nothing')).toEqual([])
  })
})

describe('filterPins', () => {
  it('matches pins by folder or profile', () => {
    expect(filterPins([pin], 'repo')).toHaveLength(1)
    expect(filterPins([pin], 'work')).toHaveLength(1)
    expect(filterPins([pin], 'zzz')).toHaveLength(0)
  })
})
