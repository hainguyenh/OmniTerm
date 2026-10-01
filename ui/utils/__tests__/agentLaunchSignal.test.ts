import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentLaunchedBy, noteAgentLaunch, noteSubmittedInput, onAgentLaunch, resetAgentLaunchSignalForTests } from '../agentLaunchSignal'
import { interceptPaneInput, resetPaneInputHoldForTests } from '../paneInputHold'

beforeEach(() => {
  resetAgentLaunchSignalForTests()
  resetPaneInputHoldForTests()
})

const bufferShowing = (line: string, type: 'normal' | 'alternate' = 'normal') => ({
  active: { type, baseY: 10, cursorY: 2, getLine: (row: number) => (row === 12 ? { translateToString: () => line } : undefined) },
})

describe('agentLaunchedBy', () => {
  it('spots an agent or profile launcher as the first word after a shell prompt', () => {
    expect(agentLaunchedBy('PS D:\\work> claude')).toBe('claude')
    expect(agentLaunchedBy('PS D:\\work> claude-th --resume 0b1c')).toBe('claude')
    expect(agentLaunchedBy('D:\\work>codex resume 019a')).toBe('codex')
    expect(agentLaunchedBy('me@box:~/src$ agy')).toBe('agy')
    expect(agentLaunchedBy('❯ claude -c')).toBe('claude')
    expect(agentLaunchedBy('PS C:\\> & C:\\Users\\me\\.local\\bin\\claude-work.cmd')).toBe('claude')
    expect(agentLaunchedBy('claude --resume 0b1c')).toBe('claude')
  })

  it('ignores other commands and one-shot agent invocations', () => {
    expect(agentLaunchedBy('PS D:\\work> echo claude')).toBeNull()
    expect(agentLaunchedBy('PS D:\\work> git commit -m "claude"')).toBeNull()
    expect(agentLaunchedBy('PS D:\\work> claude --version')).toBeNull()
    expect(agentLaunchedBy('PS D:\\work> claude -p "hello"')).toBeNull()
    expect(agentLaunchedBy('PS D:\\work> codex exec fix it')).toBeNull()
    expect(agentLaunchedBy('PS D:\\work> claudette')).toBeNull()
    expect(agentLaunchedBy('│ > claude is great │')).toBeNull()
  })
})

describe('noteSubmittedInput', () => {
  it('raises a launch when Enter submits an agent line on the normal screen', () => {
    const heard = vi.fn()
    onAgentLaunch(heard)
    noteSubmittedInput('s1', 'x', bufferShowing('PS D:\\> claude'))
    expect(heard).not.toHaveBeenCalled()
    noteSubmittedInput('s1', '\r', bufferShowing('PS D:\\> claude'))
    expect(heard).toHaveBeenCalledWith('s1', 'claude')
  })

  it('leaves a full-screen program and ordinary commands alone', () => {
    const heard = vi.fn()
    onAgentLaunch(heard)
    noteSubmittedInput('s1', '\r', bufferShowing('PS D:\\> claude', 'alternate'))
    noteSubmittedInput('s1', '\r', bufferShowing('PS D:\\> dir'))
    noteSubmittedInput('s1', '\r', { active: { baseY: 0, cursorY: 0, getLine: () => undefined } })
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('launches noted before anyone listened', () => {
  it('reach a listener that arrives soon after (session restore before the plugin is up)', () => {
    noteAgentLaunch('s1', 'claude', 1_000)
    const heard = vi.fn()
    onAgentLaunch(heard, 5_000)
    expect(heard).toHaveBeenCalledWith('s1', 'claude')
  })

  it('are dropped once stale', () => {
    noteAgentLaunch('old', 'claude', 1_000)
    const heard = vi.fn()
    onAgentLaunch(heard, 17_000)
    expect(heard).not.toHaveBeenCalled()
  })

  it('are dropped once the user has typed into the pane, which a late freeze must not cut into', () => {
    noteAgentLaunch('typed', 'codex', 1_000)
    noteAgentLaunch('untouched', 'claude', 1_000)
    interceptPaneInput('typed', 'h', 2_000)
    const heard = vi.fn()
    onAgentLaunch(heard, 2_500)
    expect(heard.mock.calls).toEqual([['untouched', 'claude']])
  })
})
