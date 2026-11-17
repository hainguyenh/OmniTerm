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

  it('sends nothing for no mentions', () => {
    expect(sendMentionsToAgentSession([], vi.fn())).toBe(false)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
