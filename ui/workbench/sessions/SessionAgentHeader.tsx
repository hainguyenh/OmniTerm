import { useRef } from 'react'

import { useQuota } from '../../features/agent-quota/quotaStore'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { IconButton } from '../../ide/ui'
import { Icon } from '../../ide/ui/icons'
import { useStoredSessions } from '../../utils/agentSessionStorage'
import { formatAttachmentPaths, saveAttachmentFiles } from '../../utils/attachmentInput'
import { agentBrandFor } from '../../utils/agentIdentity'
import { usePanePresence } from '../../utils/agentPresenceStore'
import { recordSavedAttachments } from '../../utils/sessionAttachmentStore'

import { useSessionBridge } from './sessionBridge'

/** Used share of the session's rolling quota window, while the quota monitor reads one. */
function useSessionQuotaPercent(sessionId: string): number | null {
  return useQuota((state) => {
    const terminal = state.terminals[sessionId]
    if (!state.config.enabled || !terminal) return null
    const window = state.profiles[terminal.profileKey]?.lastGood?.windows.find((item) => item.kind === 'session')
    return window ? Math.round(window.usedPct) : null
  })
}

/** Saves the picked files to the session's attachment folder and types their paths into the agent. */
async function attachFiles(sessionId: string, files: File[]): Promise<void> {
  const saved = await saveAttachmentFiles(files, sessionId)
  if (saved.length === 0) return
  recordSavedAttachments(sessionId, saved)
  const paths = formatAttachmentPaths(saved.map(({ info }) => info.path))
  if (paths) window.omnitermAPI?.connect?.localInput?.(sessionId, paths)
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
 */
export function SessionAgentHeader({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  const brand = agentBrandFor(presence?.agent)
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
      <span className="min-w-0 truncate text-[var(--fg-strong)]" title={title}>{title}</span>
    </div>
  )
}

/** Floating rows share the pane's font size controls' look: faint until pointed at. */
const FLOATING = 'absolute bottom-2 z-[5] flex items-center gap-px rounded-[var(--radius-small)] bg-[var(--bg-editor,var(--bg-app))] p-px opacity-[.55] transition-opacity hover:opacity-100 focus-within:opacity-100'

/**
 * The agent's part of the pane footer: the quota used at the bottom left, and its actions (Attach
 * file) at the bottom right, just left of the pane's font size controls and the same size.
 */
export function SessionAgentFooter({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  const brand = agentBrandFor(presence?.agent)
  const quota = useSessionQuotaPercent(sessionId)
  const input = useRef<HTMLInputElement>(null)
  if (!brand) return null
  return (
    <>
      {quota !== null && (
        <span className={`${FLOATING} left-2.5 h-[22px] px-1.5 text-[var(--fg-muted)]`} data-testid="agent-footer-quota">
          quota {quota}%
        </span>
      )}
      {/* The font size controls are three small buttons 16px from the right edge. */}
      <div className={`${FLOATING} right-[96px]`} role="toolbar" aria-label="Agent actions" data-testid="agent-footer-actions">
        <IconButton
          icon="paperclip"
          size="small"
          title="Attach files to this agent: they are saved with the session and their paths typed in"
          onClick={() => input.current?.click()}
        />
      </div>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        data-testid="agent-header-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void attachFiles(sessionId, files)
        }}
      />
    </>
  )
}
