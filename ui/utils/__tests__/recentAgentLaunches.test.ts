/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  loadRecentLaunches,
  MAX_RECENT_LAUNCHES,
  recordAgentLaunch,
  resetRecentLaunchesForTests,
} from '../recentAgentLaunches'

const STORAGE_KEY = 'omniterm:recent-agent-launches'

beforeEach(() => {
  localStorage.clear()
  resetRecentLaunchesForTests()
})

describe('recent agent launches', () => {
  it('keeps the newest first, moves a repeated agent and folder up, and stops at five', () => {
    recordAgentLaunch('claude-work', 'D:/a', 1)
    recordAgentLaunch('codex', 'D:/b', 2)
    recordAgentLaunch('claude-work', 'd:/A/', 3)
    expect(loadRecentLaunches().map((item) => [item.command, item.cwd])).toEqual([
      ['claude-work', 'd:/A/'],
      ['codex', 'D:/b'],
    ])
    for (let n = 0; n < 6; n++) recordAgentLaunch('claude', `D:/p${n}`, 10 + n)
    expect(loadRecentLaunches()).toHaveLength(MAX_RECENT_LAUNCHES)
    expect(loadRecentLaunches()[0]?.cwd).toBe('D:/p5')
  })

  it('records only agent commands and launcher names, never a shell line', () => {
    recordAgentLaunch('claude && del *', 'D:/a')
    recordAgentLaunch('claude-work', '')
    expect(loadRecentLaunches()).toEqual([])
  })

  it('drops stored entries that are not a known agent command', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { command: 'rm -rf /', cwd: 'D:/a', at: 1 },
      { command: 'claude-he', cwd: 'D:/b', at: 2 },
      { command: 'opencode', cwd: 'D:/c', at: 'x' },
    ]))
    expect(loadRecentLaunches().map((item) => item.command)).toEqual(['claude-he'])
    resetRecentLaunchesForTests()
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadRecentLaunches()).toEqual([])
  })
})
