import { FolderOpen, Monitor, Terminal } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'

import { HeaderBusyArt } from '../../plugins/agent-quota/app/paneHosts'
import { usePanePresence } from '../utils/agentPresenceStore'
import { formatTerminalTitle } from '../utils/agentTitle'
import { extractAgentWorkItem } from '../utils/agentWorkItem'
import { AgentBadge } from './AgentBadge'
import { PaneBookmarkButton } from './PaneBookmarkButton'
import SessionStatusIndicator from './SessionStatusIndicator'
import { Tooltip } from './Tooltip'

interface PaneHeaderTitleProps {
  conn: Connection
  sessionId: string | null
  sessionTitle?: string
  liveFolder?: string
  shellLabel?: string
  folderPath?: string
  onOpenFolder?: () => void
  status?: SessionStatus
  busy?: boolean
  darkMode?: boolean
}

/**
 * The identity half of a pane header: what runs here, what it is working on, and where.
 *
 * An agent pane leads with the agent's own work item (the task title it sets on its terminal) and
 * keeps the folder as quieter context; a shell pane leads with its folder. The agent itself is
 * only an icon — its name and profile are in the icon's tooltip. The process-tree presence wins
 * over title parsing, so a pane counts as an agent pane even while its title shows only a task.
 *
 * Layout: the controls take only the width their buttons need (at most half the header) and this
 * cluster takes the rest; the activity zone fills whatever the title leaves of it, up to the first
 * control (the theme button) — so the status dot, the running dots or the agent's loading artwork
 * animate inside a fixed area and never push a header button around.
 */
export function PaneHeaderTitle({
  conn, sessionId, sessionTitle, liveFolder, shellLabel, folderPath, onOpenFolder, status, busy, darkMode,
}: PaneHeaderTitleProps) {
  const presence = usePanePresence(sessionId)
  const formatted = formatTerminalTitle(sessionTitle, shellLabel, conn.name, conn.localCwd)
  const agent = presence?.agent ?? (formatted.isAgent ? formatted.agentName : undefined)
  // A shell-reported cwd (OSC 7 / 9;9) is the freshest folder signal — it wins over the title's.
  const folderLabel = liveFolder ?? formatted.folderName
  const workItem = agent ? extractAgentWorkItem(sessionTitle) : undefined
  const primary = workItem ?? folderLabel ?? formatted.displayTitle

  return (
    <>
      {agent
        ? <AgentBadge agent={agent} profileName={presence?.profileName} />
        : conn.type === 'RDP'
          ? <Monitor className="w-3 h-3 flex-shrink-0" />
          : <Terminal className="w-3 h-3 flex-shrink-0" />}
      <span className="flex min-w-0 flex-1 basis-0 self-stretch items-center gap-1 font-medium" data-testid="pane-header-title">
        <span className={`min-w-0 max-w-[70%] shrink truncate ${agent ? 'text-theme-accent' : ''}`}>
          {primary}
        </span>
        {sessionId && agent && <PaneBookmarkButton sessionId={sessionId} />}
        {workItem && folderLabel && (
          <span className="min-w-0 shrink-[2] truncate text-[10px] font-normal text-theme-dim">
            · {folderLabel}
          </span>
        )}
        {folderPath && onOpenFolder && (
          <Tooltip content="Open project folder in Explorer" placement="bottom">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenFolder() }}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
              aria-label="Open project folder in Explorer"
            >
              <FolderOpen className="w-3 h-3" />
            </button>
          </Tooltip>
        )}
        {sessionId && (
          <span className="relative flex min-w-[2.75rem] flex-1 self-stretch items-center overflow-x-clip" data-testid="pane-activity-zone">
            {busy && agent
              ? (
                <HeaderBusyArt
                  sessionId={sessionId}
                  darkMode={darkMode}
                  fallback={<SessionStatusIndicator status={status ?? 'connecting'} busy isAgent runningStyle="oscillate" />}
                />
              )
              : <SessionStatusIndicator status={status ?? 'connecting'} busy={busy} isAgent={Boolean(agent)} runningStyle="oscillate" />}
          </span>
        )}
      </span>
    </>
  )
}
