import type { QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { TerminalAgent } from './quotaStore'

/** What the quota engine (quotaEngine.ts) is given: its API, clock, timers and window hooks. */
export interface EngineDeps {
  api: AgentQuotaAPI
  now(): number
  random(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /**
   * Read quota from the agent itself when it starts in a terminal (see inlineUsageProbe.ts); null
   * when it can't, and the background read runs instead. Absent: always the background read.
   */
  inlineProbe?(terminal: TerminalAgent): Promise<QuotaSnapshot | null>
  /**
   * Freezes a pane from the moment an agent is started in it until the inline probe takes it over
   * (see `noteLaunch`); `release` lets go of a hold no probe is going to take.
   */
  launchHold?: { hold(sessionId: string): void; release(sessionId: string): void }
  /** A pane's rendered screen, for the strip's manual read (see manualUsageRead.ts). */
  readScreen?(sessionId: string): string[] | null
  /**
   * Whether the window is on screen. While it is not, the countdown clock stands still (nothing
   * shows it); guards, reads and wakes keep running. Absent: always visible.
   */
  visible?(): boolean
}

export interface EngineInputs {
  /** Terminal sessions open in this window; detection results for anything else are ignored. */
  sessionIds: readonly string[]
  busy: Readonly<Record<string, boolean>>
}
