export interface PaneRecoveryContext {
  cwd?: string
  cwdSource: 'reported' | 'launch' | 'unknown'
  shell?: string
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
