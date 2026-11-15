import { useCallback } from 'react'

import { useStackTraces } from '../../ide/features/run/stackTrace'
import { useRun } from '../../ide/features/run/store'
import {
  RunTabs as UpstreamRunTabs,
  RunView as UpstreamRunView,
} from '../../ide/features/run/RunView'
import { executeAction } from '../../ide/platform/actions'
import { Icon } from '../../ide/ui'

export interface RunConsoleToolWindowProps {
  id?: string
}

/**
 * OmniTerm workbench adapter for the Run Console tool window (`id: "run"`).
 * - Mounts upstream RunView when a run session or stack trace tab exists.
 * - Displays an OmniTerm empty state when no session is active.
 */
export function RunConsoleToolWindow(_props: RunConsoleToolWindowProps = {}) {
  const sessions = useRun((s) => s.sessions)
  const traces = useStackTraces((s) => s.tabs)
  const hasActiveSession = sessions.length > 0 || traces.length > 0

  const handleRun = useCallback(() => {
    void executeAction('run.run')
  }, [])

  const handleEditConfigs = useCallback(() => {
    void executeAction('run.editConfigs')
  }, [])

  if (hasActiveSession) {
    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden"
        data-testid="run-console-tool-window"
      >
        <UpstreamRunView />
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full flex-col justify-between overflow-y-auto p-4 text-center select-none"
      data-testid="run-console-empty-state"
    >
      <div className="my-auto flex flex-col items-center justify-center space-y-4">
        <div className="rounded-full bg-[var(--surface-hover,rgba(255,255,255,0.05))] p-4 text-[var(--foreground-muted,#888)]">
          <Icon name="toolwindow-run" size={32} />
        </div>
        <div className="max-w-md space-y-1">
          <h3 className="text-sm font-medium text-[var(--foreground,#eee)]">Run Console</h3>
          <p className="text-xs leading-relaxed text-[var(--foreground-muted,#888)]">
            Run configurations or tests with Shift+F10 or select a configuration from the title bar
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleRun}
            className="flex items-center gap-1.5 rounded bg-[var(--accent,#007acc)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover,#0062a3)] focus:outline-none"
          >
            <Icon name="run" size={14} />
            <span>Run Selected</span>
          </button>
          <button
            type="button"
            onClick={handleEditConfigs}
            className="flex items-center gap-1.5 rounded border border-[var(--border,rgba(255,255,255,0.1))] bg-[var(--surface,rgba(255,255,255,0.03))] px-3 py-1.5 text-xs font-medium text-[var(--foreground,#eee)] transition-colors hover:bg-[var(--surface-hover,rgba(255,255,255,0.08))] focus:outline-none"
          >
            <Icon name="settings" size={14} />
            <span>Edit Configurations…</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * OmniTerm adapter for the Run Console tabs in the tool window header.
 */
export function RunConsoleTabs() {
  return <UpstreamRunTabs />
}
