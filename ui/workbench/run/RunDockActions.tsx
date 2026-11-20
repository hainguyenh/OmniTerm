import { isLive, useRun } from '../../ide/features/run/store'
import { executeAction } from '../../ide/platform/actions'
import { IconButton } from '../../ide/ui'
import { useDebugRunSessions } from '../../ide/workbench/contributions'

import { runDockState } from './runDockState'

/**
 * The Run tool window's header buttons: pick a configuration, Run, Debug, Rerun and Stop. The title
 * bar's Run widget shows only while something runs (unless the user keeps it), so these are always
 * at hand where the output is.
 */
export function RunDockActions() {
  const selected = useRun((s) => s.configs.find((config) => config.id === s.selectedId))
  const sessions = useRun((s) => s.sessions.length)
  const live = useRun((s) => s.sessions.filter(isLive).length)
  const debugging = useDebugRunSessions((s) => s.sessions.length)
  const state = runDockState(selected?.name, sessions, live, debugging)
  return (
    <>
      <button
        type="button"
        className="max-w-[16ch] truncate rounded px-1.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        title="Select Run/Debug Configuration…"
        aria-label="Select Run/Debug Configuration"
        data-testid="run-dock-config"
        onClick={() => void executeAction('run.chooseConfig', 'select')}
      >
        {state.configLabel}
      </button>
      <IconButton icon="run" size="small" action="run.run" title="Run" data-testid="run-dock-run" />
      <IconButton icon="debug" size="small" action="run.debug" title="Debug" data-testid="run-dock-debug" />
      <IconButton icon="rerun" size="small" action="run.rerun" title="Rerun" disabled={!state.canRerun} data-testid="run-dock-rerun" />
      <IconButton icon="stop" size="small" action="run.stop" title="Stop" disabled={!state.running} data-testid="run-dock-stop" />
    </>
  )
}
