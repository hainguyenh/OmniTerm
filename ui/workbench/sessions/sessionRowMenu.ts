import { getQuotaState, quotaCommands } from '../../features/agent-quota/quotaStore'
import { isHeld } from '../../features/agent-quota/quotaGuard'
import type { MenuItem } from '../../ide/ui/Menu'
import { QUICK_START_AGENTS, type ClaudeProfileChoice, type QuickStartProject } from '../../utils/sessionQuickStart'
import { undockSession } from '../terminalDock/terminalDockStore'

import { sessionById, useSessionBridge } from './sessionBridge'
import { confirmSessionClose } from './sessionClose'
import { sessionInput } from './sessionInput'
import { sessionTabMenuItems } from './sessionTabMenu'

/**
 * Suspend / Resume of the agent in a session, through the quota monitor's freeze (the same one it
 * applies at the limit). Null when no agent the monitor follows runs there.
 */
function suspendItem(sessionId: string): MenuItem | null {
  const state = getQuotaState()
  const terminal = state.terminals[sessionId]
  if (!terminal) return null
  const held = isHeld(state.guards[terminal.instanceKey])
  return held
    ? { label: 'Resume Agent', icon: 'resume', run: () => quotaCommands().resume(sessionId) }
    : { label: 'Suspend Agent', icon: 'pause', run: () => quotaCommands().suspend(sessionId) }
}

/** Ends a session after the usual confirmation; its tab (or dock tab) goes with it. */
export async function killSession(sessionId: string): Promise<void> {
  if (!(await confirmSessionClose([sessionInput(sessionId)]))) return
  undockSession(sessionId)
  useSessionBridge.getState().api?.killSession(sessionId)
}

/** The context menu of a live session row in the Sessions tool window. */
export function sessionRowMenuItems(sessionId: string, show: () => void): MenuItem[] {
  if (!sessionById(sessionId)) return []
  const suspend = suspendItem(sessionId)
  return [
    { label: 'Show', icon: 'eye', run: show },
    ...(suspend ? [{ kind: 'separator' } as const, suspend] : []),
    ...sessionTabMenuItems(sessionId),
    { kind: 'separator' },
    { label: 'Kill Session', icon: 'close', run: () => void killSession(sessionId) },
  ]
}

/** The context menu (and "+") of a project in the Sessions tool window: start a session in it. */
export function projectStartMenuItems(
  project: QuickStartProject,
  start: (project: QuickStartProject, command: string | null) => void,
  claudeProfiles: readonly ClaudeProfileChoice[] = [],
): MenuItem[] {
  return [
    { kind: 'header', label: project.label },
    ...QUICK_START_AGENTS.map((agent): MenuItem => {
      const item: MenuItem = {
        label: agent.command ? `New ${agent.label} Session` : 'New Terminal',
        icon: agent.command ? (agent.icon ?? `agent-${agent.id}`) : 'terminal',
        run: () => start(project, agent.command),
      }
      // With several Claude profiles on this machine, the row also opens a list to pick one from.
      if (agent.id !== 'claude' || claudeProfiles.length < 2) return item
      return {
        ...item,
        submenu: claudeProfiles.map((choice): MenuItem => ({
          label: choice.label,
          verbatim: true,
          run: () => start(project, choice.command),
        })),
      }
    }),
  ]
}
