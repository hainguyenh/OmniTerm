import { getQuotaState, quotaCommands, requestConfirm, setEditing, setOverride } from './quotaStore'
import { pruneOverride } from './quotaConfig'
import type { TerminalAgent } from './quotaStore'

/**
 * Turning suspend off removes the only thing that stops an agent at its limit, so it always goes
 * through an explicit, danger-styled confirmation — globally or for a single terminal.
 */
export function confirmDisableSuspend(scope: string, apply: () => void): void {
  requestConfirm({
    title: 'Turn off auto-suspend?',
    message: `${scope} will keep running after it reaches its limit. It can use up the rest of your quota and any paid credits, and nothing will stop it.`,
    confirmLabel: 'Turn off suspend',
    onConfirm: apply,
  })
}

/** Resume one frozen terminal only after an explicit danger confirmation. */
export function confirmResumeNow(terminal: TerminalAgent, afterConfirm?: () => void): void {
  requestConfirm({
    title: 'Resume process now?',
    message: `${terminal.profileName} will resume immediately and its suspend-at-limit protection will be turned off for this terminal. It can consume the rest of the quota until the session ends.`,
    confirmLabel: 'Resume now',
    onConfirm: () => {
      const current = getQuotaState()
      const live = current.terminals[terminal.sessionId]
      if (!live) return
      const global = current.config.agents[live.agent]
      const override = current.overrides[live.instanceKey]
      setOverride(live.instanceKey, pruneOverride(global, { ...override, enabled: false, suspendAtLimit: false }))
      quotaCommands().resume(live.sessionId)
      setEditing(null)
      afterConfirm?.()
    },
  })
}
