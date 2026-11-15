import { useRef } from 'react'

import { useQuota } from '../../../plugins/agent-quota/app/quotaStore'
import { Icon } from '../../ide/ui/icons'
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

/**
 * The header row of an agent session (`agentView` specification): the agent, its
 * working folder, the quota it has used and an Attach file action. Shown only while an AI agent
 * runs in the session; a plain terminal has no header.
 */
export function SessionAgentHeader({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  const brand = agentBrandFor(presence?.agent)
  const cwd = useSessionBridge((state) => state.sessions.find((session) => session.id === sessionId)?.cwd ?? null)
  const quota = useSessionQuotaPercent(sessionId)
  const input = useRef<HTMLInputElement>(null)
  if (!brand) return null
  return (
    <div
      className="flex flex-none items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border)] min-w-0"
      data-session-agent-header={brand}
    >
      <Icon name={`ext:omniterm/agent-${brand}`} size={16} />
      <b className="flex-none text-[var(--fg-strong)]">{brand}</b>
      {cwd && <span className="min-w-0 truncate text-[var(--fg-subtle)]" title={cwd}>{cwd}</span>}
      <span className="flex-1" />
      {quota !== null && <span className="flex-none text-[var(--fg-muted)]" data-testid="agent-header-quota">quota {quota}%</span>}
      <button
        type="button"
        className="flex-none inline-flex items-center gap-1 h-[26px] px-1.5 rounded-[5px] hover:bg-[var(--bg-toolbar-hover)]"
        title="Attach files to this agent: they are saved with the session and their paths typed in"
        onClick={() => input.current?.click()}
      >
        <Icon name="paperclip" size={16} />
        Attach file
      </button>
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
    </div>
  )
}
