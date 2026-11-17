import { setReferenceSink } from '../../ide/features/agents/references'
import { diag } from '../../diag'
import { notifications, toolWindowService } from '../../ide/workbench/contributions'
import { getPanePresence } from '../../utils/agentPresenceStore'
import { normalizePastePayload } from '../../utils/paste'

import { useSessionBridge } from './sessionBridge'
import { showSessionTab } from './sessionTabActions'
import { activeSessionId } from './sessionToolbar'

const runsAgent = (sessionId: string): boolean => !!getPanePresence(sessionId)?.agent

/**
 * The session "Send to Agent" types into: the active tab when an agent runs in it, else the most
 * recently opened session with an agent.
 */
export function agentSessionTarget(): string | null {
  const active = activeSessionId()
  if (active && runsAgent(active)) return active
  const sessions = useSessionBridge.getState().sessions
  for (let index = sessions.length - 1; index >= 0; index--) {
    const id = sessions[index]!.id
    if (runsAgent(id)) return id
  }
  return null
}

/** The Sessions tool window, where agent sessions are started. */
const SESSIONS_WINDOW = 'omniterm.sessions'

function notifyNoAgentSession(toComposer: () => void): void {
  notifications().notify({
    level: 'info',
    title: 'No agent session to send to',
    body: 'Start an agent such as Claude Code or Codex from the Sessions tool window, then send again.',
    actions: [
      { label: 'Open Sessions', run: () => toolWindowService().show(SESSIONS_WINDOW, true) },
      { label: 'Add to Agent Chat', run: toComposer },
    ],
    key: 'send-to-agent:no-session',
    userInitiated: true,
  })
}

/**
 * Types `mentions` (`@path`, `@path:12-20`) into the running agent's prompt as a paste, without
 * submitting it, and shows that session. Without an agent session it says so and offers to start
 * one or to use the agent chat (`toComposer`) instead of acting on its own.
 */
export function sendMentionsToAgentSession(mentions: readonly string[], toComposer: () => void): boolean {
  if (mentions.length === 0) return false
  const target = agentSessionTarget()
  if (!target) {
    notifyNoAgentSession(toComposer)
    return true
  }
  const text = `${mentions.join(' ')} `
  Promise.resolve(window.omnitermAPI.connect.localInput(target, normalizePastePayload(text, true)))
    .catch((error: unknown) => diag.error('[agents] could not send the reference to the agent session', error))
  showSessionTab(target)
  return true
}

/** Routes the IDE's "Send to Agent" to OmniTerm's agent sessions for as long as it is registered. */
export function registerAgentReferenceSink(): () => void {
  return setReferenceSink(sendMentionsToAgentSession)
}
