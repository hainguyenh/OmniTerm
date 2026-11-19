/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPanePresenceForTests, setPanePresence } from '../../../utils/agentPresenceStore'
import { mockOmnitermAPI } from '../../../testUtils'
import { resetSessionBridge, useSessionBridge } from '../sessionBridge'
import type { SessionInfo } from '../sessionBridge'

const mocks = vi.hoisted(() => ({ notify: vi.fn(), show: vi.fn(), showSessionTab: vi.fn() }))

vi.mock('../../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifications: () => ({ notify: mocks.notify }),
  toolWindowService: () => ({ show: mocks.show }),
}))
vi.mock('../sessionTabActions', () => ({ showSessionTab: mocks.showSessionTab }))
vi.mock('../sessionToolbar', () => ({ activeSessionId: () => null }))

import { sendMentionsToAgentSession } from '../sendToAgentSession'

interface Notice {
  title: string
  actions: Array<{ label: string, run: () => void }>
}

const session = (id: string): SessionInfo => ({
  id, connId: id, name: id, connType: 'LOCAL', workspaceId: null, status: 'connected', busy: false, cwd: null, hasCommand: false,
})

let localInput: ReturnType<typeof vi.fn>

beforeEach(() => {
  localInput = vi.fn(async () => {})
  mockOmnitermAPI({ connect: { localInput } })
  useSessionBridge.setState({ sessions: [session('shell'), session('agent')] })
})

afterEach(() => {
  resetSessionBridge()
  resetPanePresenceForTests()
  vi.clearAllMocks()
})

describe('sendMentionsToAgentSession', () => {
  it('pastes the mentions into the agent session and shows it', () => {
    setPanePresence({ agent: { agent: 'claude', profileName: 'claude', pid: 1, startTime: 1 } })

    expect(sendMentionsToAgentSession(['@src'], vi.fn())).toBe(true)

    expect(localInput).toHaveBeenCalledWith('agent', expect.stringContaining('@src '))
    expect(mocks.showSessionTab).toHaveBeenCalledWith('agent')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  // Regression: with no agent session running, "Send to Agent" gave no feedback the user could act
  // on. It now says so and offers to start one from the Sessions tool window or use the agent chat.
  it('offers to start an agent session when none runs', () => {
    const toComposer = vi.fn()

    expect(sendMentionsToAgentSession(['@src'], toComposer)).toBe(true)

    expect(localInput).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    const notice = mocks.notify.mock.calls[0]![0] as Notice
    expect(notice.title).toBe('No agent session to send to')
    expect(notice.actions.map((action) => action.label)).toEqual(['Open Sessions', 'Add to Agent Chat'])
    notice.actions[0]!.run()
    expect(mocks.show).toHaveBeenCalledWith('omniterm.sessions', true)
    notice.actions[1]!.run()
    expect(toComposer).toHaveBeenCalledTimes(1)
  })

  // Regression: after every agent was quit, a local tab still titled after its agent kept a
  // title-inferred presence (pid 0). "Send to Agent" then typed into that plain shell and jumped to
  // its tab, which looked like an agent session being opened or resumed out of nowhere.
  it('ignores a local pane whose agent is only inferred from its stale tab title', () => {
    setPanePresence({ agent: { agent: 'claude', profileName: 'claude', pid: 0, startTime: 0 } })

    expect(sendMentionsToAgentSession(['@src'], vi.fn())).toBe(true)

    expect(localInput).not.toHaveBeenCalled()
    expect(mocks.showSessionTab).not.toHaveBeenCalled()
    expect((mocks.notify.mock.calls[0]![0] as Notice).title).toBe('No agent session to send to')
  })

  it('trusts the title of a remote pane, which has no process tree to inspect', () => {
    useSessionBridge.setState({ sessions: [{ ...session('agent'), connType: 'SSH' }] })
    setPanePresence({ agent: { agent: 'claude', profileName: 'claude', pid: 0, startTime: 0 } })

    sendMentionsToAgentSession(['@src'], vi.fn())

    expect(localInput).toHaveBeenCalledWith('agent', expect.stringContaining('@src '))
  })

  it('sends nothing for no mentions', () => {
    expect(sendMentionsToAgentSession([], vi.fn())).toBe(false)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
