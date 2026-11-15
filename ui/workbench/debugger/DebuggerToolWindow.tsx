import { useCallback } from 'react'

import { useDebug } from '../../ide/features/debugger/state'
import {
  DebugTabs as UpstreamDebugTabs,
  DebugToolWindow as UpstreamDebugToolWindow,
} from '../../ide/features/debugger/ui/DebugToolWindow'
import { executeAction } from '../../ide/platform/actions'
import { Icon } from '../../ide/ui'

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
      <div className="my-auto flex flex-col items-center justify-center space-y-4">
        <div className="rounded-full bg-[var(--surface-hover,rgba(255,255,255,0.05))] p-4 text-[var(--foreground-muted,#888)]">
          <Icon name="toolwindow-debug" size={32} />
        </div>
        <div className="max-w-md space-y-1">
          <h3 className="text-sm font-medium text-[var(--foreground,#eee)]">Debugger</h3>
          <p className="text-xs leading-relaxed text-[var(--foreground-muted,#888)]">
            Debugger: Inspect call stacks, threads, variables, and watch expressions
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleStartDebug}
            className="flex items-center gap-1.5 rounded bg-[var(--accent,#007acc)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover,#0062a3)] focus:outline-none"
          >
            <Icon name="debug" size={14} />
            <span>Start Debugging</span>
          </button>
          <button
            type="button"
            onClick={handleViewBreakpoints}
            className="flex items-center gap-1.5 rounded border border-[var(--border,rgba(255,255,255,0.1))] bg-[var(--surface,rgba(255,255,255,0.03))] px-3 py-1.5 text-xs font-medium text-[var(--foreground,#eee)] transition-colors hover:bg-[var(--surface-hover,rgba(255,255,255,0.08))] focus:outline-none"
          >
            <Icon name="view-breakpoints" size={14} />
            <span>View Breakpoints…</span>
          </button>
        </div>
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
