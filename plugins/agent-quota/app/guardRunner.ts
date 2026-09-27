import type { QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { GuardAction, GuardState } from './quotaGuard'
import type { TerminalAgent } from './quotaStore'

import { AGENT_LABELS, pruneOverride } from './quotaConfig'
import { INITIAL_GUARD, isHeld, manualResume, stepGuard, suspendFailed } from './quotaGuard'
import { getQuotaState, pushNotice, setOverride, terminalConfig, updateQuota } from './quotaStore'

/**
 * Runs the guard for every terminal on a profile after a reading, and carries out what it decides.
 * Kept apart from the engine's scheduling so each half stays readable and testable on its own.
 */

export const subjectOf = (terminal: TerminalAgent) => `${AGENT_LABELS[terminal.agent]} (${terminal.profileName})`

function writeGuard(instanceKey: string, guard: GuardState): void {
  updateQuota((current) => ({ ...current, guards: { ...current.guards, [instanceKey]: guard } }))
}

/** Carry out one action. False when a suspend froze nothing, which voids the rest of the step. */
async function runAction(api: AgentQuotaAPI, terminal: TerminalAgent, action: GuardAction): Promise<boolean> {
  const { sessionId, pid, startTime, instanceKey } = terminal
  if (action.type === 'notify') {
    pushNotice(action.level, action.message)
    return true
  }
  if (action.type === 'resume') {
    await api.resume(sessionId)
    return true
  }
  if (action.type === 'terminate') {
    await api.terminate(sessionId, pid, startTime)
    return true
  }
  try {
    const report = await api.suspend(sessionId, pid, startTime)
    if (action.type === 'suspend' && report.frozen.length === 0) {
      writeGuard(instanceKey, suspendFailed(getQuotaState().guards[instanceKey] ?? INITIAL_GUARD))
      pushNotice('danger', `Could not suspend ${subjectOf(terminal)}: ${report.errors[0] ?? 'no process was frozen'}.`)
      return false
    }
    if (action.type === 'rescan' && report.newlyFrozen > 0) {
      pushNotice('warning', `Froze ${report.newlyFrozen} more AI process${report.newlyFrozen === 1 ? '' : 'es'} started by ${subjectOf(terminal)}.`)
    }
    return true
  } catch (error) {
    if (action.type !== 'suspend') return true
    writeGuard(instanceKey, suspendFailed(getQuotaState().guards[instanceKey] ?? INITIAL_GUARD))
    pushNotice('danger', `Could not suspend ${subjectOf(terminal)}: ${String(error)}`)
    return false
  }
}

/** Step every terminal on `profileKey` against the new reading and run the resulting actions. */
export async function runGuards(api: AgentQuotaAPI, profileKey: string, snapshot: QuotaSnapshot, now: number): Promise<void> {
  const current = getQuotaState()
  const terminals = Object.values(current.terminals).filter((terminal) => terminal.profileKey === profileKey)
  for (const terminal of terminals) {
    const config = terminalConfig(getQuotaState(), terminal)
    if (!config.enabled) continue
    const previous = getQuotaState().guards[terminal.instanceKey] ?? INITIAL_GUARD
    const step = stepGuard(previous, { snapshot, config, now, subject: subjectOf(terminal) })
    if (step.state !== previous) writeGuard(terminal.instanceKey, step.state)
    for (const action of step.actions) {
      if (!(await runAction(api, terminal, action))) break
    }
  }
}

/**
 * Thaw terminals whose guard no longer applies: the feature or the agent was switched off, or
 * suspend was turned off for it (the user confirmed that in the danger dialog).
 */
export async function releaseUnguarded(api: AgentQuotaAPI): Promise<void> {
  const current = getQuotaState()
  for (const terminal of Object.values(current.terminals)) {
    const guard = current.guards[terminal.instanceKey]
    if (!isHeld(guard)) continue
    const config = terminalConfig(current, terminal)
    if (current.config.enabled && config.enabled && config.suspendAtLimit) continue
    writeGuard(terminal.instanceKey, { ...INITIAL_GUARD })
    await api.resume(terminal.sessionId)
    pushNotice('info', `${subjectOf(terminal)} resumed: its quota guard was switched off.`)
  }
}

/** "Resume anyway": thaw now and do not re-freeze before the window resets. */
export async function resumeByHand(api: AgentQuotaAPI, sessionId: string, now: number): Promise<void> {
  const terminal = getQuotaState().terminals[sessionId]
  if (!terminal) return
  const current = getQuotaState()
  const global = current.config.agents[terminal.agent]
  const guard = getQuotaState().guards[terminal.instanceKey] ?? INITIAL_GUARD
  setOverride(terminal.instanceKey, pruneOverride(global, {
    ...current.overrides[terminal.instanceKey],
    enabled: false,
    suspendAtLimit: false,
  }))
  writeGuard(terminal.instanceKey, manualResume(guard, now))
  await api.resume(sessionId)
  pushNotice('info', `${subjectOf(terminal)} resumed by hand. Monitoring is paused for this agent until you enable it again.`)
}
