export interface RunDockState {
  /** The selected configuration's name, or a prompt when none is selected. */
  configLabel: string
  /** Something runs or is being debugged: Stop applies. */
  running: boolean
  /** A session (running or finished) exists to rerun. */
  canRerun: boolean
}

/** What the Run tool window header's buttons show and allow. */
export function runDockState(
  selectedName: string | undefined,
  sessions: number,
  liveRuns: number,
  debugSessions: number,
): RunDockState {
  return {
    configLabel: selectedName?.trim() || 'Add Configuration…',
    running: liveRuns > 0 || debugSessions > 0,
    canRerun: sessions > 0,
  }
}
