import { AttachmentsFooterButton } from '../../components/AttachmentsFooterButton'
import { useAgentStatusLine } from '../../features/agent-quota/agentStatusLine'
import { HeaderBusyArt } from '../../features/agent-quota/HeaderBusyArt'
import { useQuota } from '../../features/agent-quota/quotaStore'
import { requestRenewFromPane } from '../../hooks/useRenewSession'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { IconButton } from '../../ide/ui'
import { Icon } from '../../ide/ui/icons'
import { useStoredSessions } from '../../utils/agentSessionStorage'
import { agentBrandFor } from '../../utils/agentIdentity'
import { usePanePresence } from '../../utils/agentPresenceStore'
import { clearPaneConsole } from '../../utils/paneConsoles'
import { dispatchTerminalSave } from '../../utils/terminalCopyExtract'

import { useSessionBridge } from './sessionBridge'
import { useRootDarkMode } from './useRootDarkMode'

/** Used share of the session's rolling quota window, while the quota monitor reads one. */
function useSessionQuotaPercent(sessionId: string): number | null {
  return useQuota((state) => {
    const terminal = state.terminals[sessionId]
    if (!state.config.enabled || !terminal) return null
    const window = state.profiles[terminal.profileKey]?.lastGood?.windows.find((item) => item.kind === 'session')
    return window ? Math.round(window.usedPct) : null
  })
}

/** The last segment of a folder path (`D:/work/omniterm` → `omniterm`). */
const folderName = (path: string | null | undefined): string =>
  path?.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** The project the session works in: its workspace's name, else its working folder's name. */
function useSessionProjectName(sessionId: string): string {
  const session = useSessionBridge((state) => state.sessions.find((item) => item.id === sessionId))
  const workspace = useWorkspaceStore(
    (state) => state.workspaces.find((item) => item.id === session?.workspaceId)?.name ?? '',
  )
  return workspace || folderName(session?.cwd)
}

/**
 * The header row of an agent session (`agentView` specification): the agent's icon and the title
 * of its conversation (what the agent works on), else the project it works in. The terminal's own
 * name (`pwsh`, the shell's window title) says nothing about the agent, so it is never shown, and
 * the profile is the tab's label. Shown only while an AI agent runs; a plain terminal has no header.
 *
 * While the agent works (its terminal is active), the row up to 80% of its width is the activity zone: the
 * Agent Quota pace artwork travels across it (Settings › Agent Quota › Loading artwork). The zone
 * keeps its size whether or not art shows, so the title never moves.
 */
export function SessionAgentHeader({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  const brand = agentBrandFor(presence?.agent)
  const busy = useSessionBridge((state) => state.sessions.find((item) => item.id === sessionId)?.busy === true)
  const darkMode = useRootDarkMode()
  const project = useSessionProjectName(sessionId)
  // The conversation's title (as the Sessions list shows it) once the agent saved one.
  const conversation = useStoredSessions().find((session) => session.tabId === sessionId)?.title
  if (!brand) return null
  const title = conversation || project || brand
  return (
    <div
      className="flex flex-none items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border)] min-w-0"
      data-session-agent-header={brand}
    >
      <Icon name={`ext:omniterm/agent-${brand}`} size={16} />
      <span className="min-w-0 max-w-[70%] shrink truncate text-[var(--fg-strong)]" title={title}>{title}</span>
      <span className="relative mr-[20%] flex min-w-[2.75rem] flex-1 self-stretch items-center overflow-x-clip" data-testid="agent-activity-zone">
        {busy && <HeaderBusyArt sessionId={sessionId} darkMode={darkMode} fallback={null} />}
      </span>
    </div>
  )
}

/**
 * The agent's footer: a 26px row of its own under the terminal, so it never covers the agent's
 * last lines (it floated over them before). The pane's font size controls sit centred in it, as
 * they do in a code editor's bottom breadcrumbs (`data-agent-footer`, EditorArea.module.css).
 *
 * At the left the agent's own status line (one row, whole on hover), else the quota used; at the
 * right, just left of the font size controls and the same size: the attachments list (Attach
 * files, what this pane attached), Export the console (the whole conversation for Claude, else the
 * terminal buffer), Clear the console, and Renew it (a fresh agent in this pane, asked for and
 * done as Settings › renew strategy says).
 */
export function SessionAgentFooter({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  const brand = agentBrandFor(presence?.agent)
  const quota = useSessionQuotaPercent(sessionId)
  const statusLine = useAgentStatusLine(sessionId)
  if (!brand) return null
  return (
    <div
      className="flex h-[26px] flex-none items-center gap-2 border-t border-[var(--border)] pl-2.5 pr-[96px] text-[11px] text-[var(--fg-muted)]"
      data-agent-footer=""
      data-testid="agent-footer"
    >
      <span className="min-w-0 flex-1 truncate">
        {statusLine ? (
          <span title={statusLine} data-testid="agent-footer-statusline">{statusLine}</span>
        ) : quota !== null && (
          <span data-testid="agent-footer-quota">quota {quota}%</span>
        )}
      </span>
      {/* The font size controls are three small buttons 16px from the right edge. */}
      <div
        className="flex flex-none items-center gap-px opacity-[.55] transition-opacity hover:opacity-100 focus-within:opacity-100"
        role="toolbar"
        aria-label="Agent actions"
        data-testid="agent-footer-actions"
      >
        <AttachmentsFooterButton sessionId={sessionId} />
        <IconButton
          icon="download"
          size="small"
          title="Export the whole console to a file"
          onClick={() => dispatchTerminalSave(sessionId)}
        />
        <IconButton
          icon="broom"
          size="small"
          title="Clear the console (the agent and its conversation stay)"
          onClick={() => clearPaneConsole(sessionId)}
        />
        <IconButton
          icon="refresh"
          size="small"
          title="Renew the console: start a fresh agent in this pane"
          onClick={() => requestRenewFromPane(sessionId)}
        />
      </div>
    </div>
  )
}
