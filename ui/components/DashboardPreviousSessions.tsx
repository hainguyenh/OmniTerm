import React, { useState } from 'react'
import { BookmarkCheck, Clock, Folder, Play, Snowflake, Trash2, X } from 'lucide-react'
import {
  clearStoredSessions,
  isBookmarked,
  removeStoredSession,
  useStoredSessions,
  type StoredAgentSession,
} from '../utils/agentSessionStorage'
import { formatTimeAgo, resumeCommandFor, sessionFolderName } from '../utils/storedSessionResume'
import { AgentBadge } from './AgentBadge'
import { Tooltip } from './Tooltip'

interface DashboardPreviousSessionsProps {
  onResume: (session: StoredAgentSession, resumeCommand: string) => void
  compact?: boolean
}

export const DashboardPreviousSessions: React.FC<DashboardPreviousSessionsProps> = ({
  onResume,
  compact = false,
}) => {
  // Bookmarks lead: they are what the user explicitly asked to come back to.
  const sessions = useStoredSessions()
    .filter(session => session.state !== 'active')
    .sort((a, b) => Number(isBookmarked(b)) - Number(isBookmarked(a)) || b.updatedAt - a.updatedAt)
  const [confirmingClear, setConfirmingClear] = useState(false)

  if (sessions.length === 0) {
    return null
  }

  const handleClearAll = () => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    clearStoredSessions()
    setConfirmingClear(false)
  }

  return (
    <div className={`w-full flex flex-col gap-2.5 my-2 ${compact ? 'max-w-2xl px-2' : 'max-w-5xl px-4'}`}>
      <div className="flex items-center justify-between text-xs text-theme-dim pb-1 border-b border-theme-border/50">
        <div className="flex items-center gap-1.5 font-semibold text-theme-fg">
          <Clock className="w-3.5 h-3.5 text-theme-accent" />
          <span>Previous Sessions</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-theme-accent/20 text-theme-accent">
            {sessions.length}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClearAll}
          onBlur={() => setConfirmingClear(false)}
          className={`text-[11px] transition-colors flex items-center gap-1 ${
            confirmingClear ? 'text-theme-error font-semibold' : 'text-theme-dim hover:text-theme-error'
          }`}
          title="Clear all stored sessions"
        >
          <Trash2 className="w-3 h-3" />
          <span>{confirmingClear ? 'Click again to confirm' : 'Clear all'}</span>
        </button>
      </div>

      <div className={`overflow-y-auto pr-1 ${compact ? 'flex flex-col gap-2 max-h-48' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[30rem]'}`}>
        {sessions.map((session) => {
          const isInterrupted = session.state === 'interrupted'
          const bookmarked = isBookmarked(session)
          const displayFolder = sessionFolderName(session)
          const resumeCommand = resumeCommandFor(session)

          if (compact) {
            return (
              <div
                key={session.id}
                className="flex items-center justify-between p-2.5 rounded-lg border border-theme-border bg-theme-sidebar hover:border-theme-accent/60 transition-all text-xs group"
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-2">
                  <div className="p-1.5 rounded-md bg-theme-accent/10 flex-shrink-0 mt-0.5">
                    <AgentBadge agent={session.agent} profileName={session.profileName} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-theme-fg truncate max-w-[18rem]" title={session.title ?? displayFolder}>
                        {session.title ?? displayFolder}
                      </span>
                      {session.launcher && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 text-theme-dim border border-theme-border">
                          {session.launcher}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          isInterrupted
                            ? 'bg-theme-warning/20 text-theme-warning border border-theme-warning/30'
                            : 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30'
                        }`}
                      >
                        {isInterrupted ? <Snowflake className="w-2.5 h-2.5" /> : null}
                        {isInterrupted ? 'Interrupted' : 'Bookmarked'}
                      </span>
                      {isInterrupted && bookmarked && (
                        <span className="inline-flex items-center text-theme-accent" aria-label="Bookmarked" title="Bookmarked">
                          <BookmarkCheck className="w-3 h-3" fill="currentColor" />
                        </span>
                      )}
                      <span className="text-[10px] text-theme-dim ml-auto">
                        {formatTimeAgo(session.updatedAt)}
                      </span>
                    </div>

                    {session.cwd && (
                      <div className="flex items-center gap-1 text-[11px] text-theme-dim truncate">
                        <Folder className="w-3 h-3 flex-shrink-0 opacity-70" />
                        <span className="truncate" title={session.cwd}>
                          {session.cwd}
                        </span>
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-theme-dim/70">
                      ID: {session.sessionId.slice(0, 8)}...
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Tooltip content={resumeCommand ? `Resume: ${resumeCommand}` : `Resume session in ${displayFolder}`} placement="top">
                    <button
                      type="button"
                      disabled={!resumeCommand}
                      onClick={() => resumeCommand && onResume(session, resumeCommand)}
                      aria-label={`Resume ${session.launcher ?? 'Claude'} session in ${displayFolder}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-theme-accent text-theme-accent-fg font-medium text-xs hover:opacity-90 transition-opacity shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Resume</span>
                    </button>
                  </Tooltip>

                  <Tooltip content="Remove from list" placement="top">
                    <button
                      type="button"
                      onClick={() => removeStoredSession(session.id)}
                      className="p-1.5 rounded text-theme-dim hover:text-theme-error hover:bg-white/5 transition-colors"
                      aria-label={`Remove ${session.launcher ?? 'Claude'} session in ${displayFolder} from the list`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            )
          }

          return (
            <div
              key={session.id}
              className="flex flex-col justify-between p-3 rounded-xl border border-theme-border bg-theme-sidebar/80 hover:border-theme-accent/60 hover:bg-theme-sidebar transition-all text-xs group shadow-sm gap-2.5"
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 rounded-md bg-theme-accent/10 flex-shrink-0">
                    <AgentBadge agent={session.agent} profileName={session.profileName} className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-theme-fg truncate" title={session.title ?? displayFolder}>
                      {session.title ?? displayFolder}
                    </span>
                    <span className="text-[10px] text-theme-dim">
                      {formatTimeAgo(session.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      isInterrupted
                        ? 'bg-theme-warning/20 text-theme-warning border border-theme-warning/30'
                        : 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30'
                    }`}
                  >
                    {isInterrupted ? <Snowflake className="w-2.5 h-2.5" /> : null}
                    {isInterrupted ? 'Interrupted' : 'Bookmarked'}
                  </span>
                  {isInterrupted && bookmarked && (
                    <span className="inline-flex items-center text-theme-accent" aria-label="Bookmarked" title="Bookmarked">
                      <BookmarkCheck className="w-3 h-3" fill="currentColor" />
                    </span>
                  )}
                </div>
              </div>

              {session.cwd && (
                <div className="flex items-center gap-1.5 text-[11px] text-theme-dim truncate bg-white/[0.03] px-2 py-1 rounded">
                  <Folder className="w-3 h-3 flex-shrink-0 opacity-70" />
                  <span className="truncate" title={session.cwd}>{session.cwd}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-theme-dim/70 font-mono">
                <span>ID: {session.sessionId.slice(0, 8)}...</span>
                {session.launcher && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 text-theme-dim border border-theme-border">
                    {session.launcher}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-theme-border/40 mt-auto">
                <Tooltip content={resumeCommand ? `Resume: ${resumeCommand}` : `Resume session in ${displayFolder}`} placement="top">
                  <button
                    type="button"
                    disabled={!resumeCommand}
                    onClick={() => resumeCommand && onResume(session, resumeCommand)}
                    aria-label={`Resume ${session.launcher ?? 'Claude'} session in ${displayFolder}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-theme-accent text-theme-accent-fg font-medium text-xs hover:opacity-90 transition-opacity shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Resume</span>
                  </button>
                </Tooltip>

                <Tooltip content="Remove from list" placement="top">
                  <button
                    type="button"
                    onClick={() => removeStoredSession(session.id)}
                    className="p-1.5 rounded-md text-theme-dim hover:text-theme-error hover:bg-white/5 transition-colors"
                    aria-label={`Remove ${session.launcher ?? 'Claude'} session in ${displayFolder} from the list`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DashboardPreviousSessions
