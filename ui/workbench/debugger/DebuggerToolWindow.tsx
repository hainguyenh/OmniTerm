import { useCallback } from 'react'

import { useDebug } from '../../ide/features/debugger/state'
import {
  DebugTabs as UpstreamDebugTabs,
  DebugToolWindow as UpstreamDebugToolWindow,
} from '../../ide/features/debugger/ui/DebugToolWindow'
import { executeAction } from '../../ide/platform/actions'
import { Button, Icon } from '../../ide/ui'

export interface DebuggerToolWindowProps {
  id?: string
}

/**
 * OmniTerm workbench adapter for the Debugger tool window (`id: "debug"`).
 * - Mounts upstream DebugToolWindow when a debug session is active or available.
 * - Displays an OmniTerm branded empty state when no debug session is running.
 */
export function DebuggerToolWindow(_props: DebuggerToolWindowProps = {}) {
  const active = useDebug((s) => (s.active != null ? s.sessions[s.active] : undefined))
  const sessionCount = useDebug((s) => Object.keys(s.sessions).length)
  const hasSession = !!active || sessionCount > 0

  const handleStartDebug = useCallback(() => {
    void executeAction('run.debug')
  }, [])

  const handleViewBreakpoints = useCallback(() => {
    void executeAction('debug.viewBreakpoints')
  }, [])

  if (hasSession) {
    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden"
        data-testid="debugger-tool-window"
      >
        <UpstreamDebugToolWindow />
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full flex-col justify-between overflow-y-auto p-4 text-center select-none"
      data-testid="debugger-empty-state"
    >
      <div className="my-auto flex flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-[var(--bg-hover)] p-4 text-[var(--fg-muted)]">
          <Icon name="toolwindow-debug" size={32} />
        </div>
        <h3 className="text-sm font-medium text-[var(--fg-strong)]">Debugger</h3>
        {/* Right under the title, well apart so one is not clicked for the other. */}
        <div className="flex flex-wrap items-center justify-center gap-6" data-testid="debugger-actions">
          <Button variant="primary" icon="debug" onClick={handleStartDebug}>
            Start Debugging
          </Button>
          <Button variant="secondary" icon="view-breakpoints" onClick={handleViewBreakpoints}>
            View Breakpoints…
          </Button>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-[var(--fg-muted)]">
          Debugger: Inspect call stacks, threads, variables, and watch expressions
        </p>
      </div>
    </div>
  )
}

/**
 * OmniTerm adapter for the Debugger tabs in the tool window header.
 */
export function DebuggerTabs() {
  return <UpstreamDebugTabs />
}
