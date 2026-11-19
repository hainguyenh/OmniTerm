import { useCallback } from 'react'

import { useStackTraces } from '../../ide/features/run/stackTrace'
import { useRun } from '../../ide/features/run/store'
import {
  RunTabs as UpstreamRunTabs,
  RunView as UpstreamRunView,
} from '../../ide/features/run/RunView'
import { executeAction } from '../../ide/platform/actions'
import { Button, Icon } from '../../ide/ui'

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
      <div className="my-auto flex flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-[var(--bg-hover)] p-4 text-[var(--fg-muted)]">
          <Icon name="toolwindow-run" size={32} />
        </div>
        <h3 className="text-sm font-medium text-[var(--fg-strong)]">Run Console</h3>
        {/* Right under the title, well apart so one is not clicked for the other. */}
        <div className="flex flex-wrap items-center justify-center gap-6" data-testid="run-console-actions">
          <Button variant="primary" icon="run" onClick={handleRun}>
            Run Selected
          </Button>
          <Button variant="secondary" icon="settings" onClick={handleEditConfigs}>
            Edit Configurations…
          </Button>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-[var(--fg-muted)]">
          Run configurations or tests with Shift+F10 or select a configuration from the title bar
        </p>
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
