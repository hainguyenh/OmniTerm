export interface PaneRecoveryContext {
  cwd?: string
  cwdSource: 'reported' | 'launch' | 'unknown'
  shell?: string
  agent?: string
  agentSessionId?: string
  profileName?: string
  launcher?: string
}

export type DetachedContextUpdate = {
  sessionId: string
  cwd?: string
  title?: string
}

export type RestorePhase = 'pending' | 'recovering' | 'ready' | 'failed'
export type RestoreAction = 'retry-session'

export type RestoreOutcome = {
  phase: RestorePhase
  message: string
  retryable: boolean
  action?: RestoreAction
}
