import { useState } from 'react'
import {
  Bookmark,
  BookmarkX,
  Folder,
  FolderOpen,
  Pin,
  PinOff,
  Play,
  Search,
  SquareTerminal,
  X,
} from 'lucide-react'

import { togglePin, removePin, usePins, type AgentWorkspacePin } from '../utils/agentBookmarkPins'
import { isBookmarked, removeStoredSession, setSessionBookmarked, useStoredSessions, type StoredAgentSession } from '../utils/agentSessionStorage'
import { filterPins, groupBookmarks, type FolderGroup } from '../utils/bookmarkGroups'
import { formatTimeAgo, resumeCommandFor } from '../utils/storedSessionResume'
import { AgentBadge } from './AgentBadge'
import { Tooltip } from './Tooltip'

interface BookmarksPanelProps {
  /** Open a fresh pane in `cwd` running `command` (a resume, or a fresh profile launch). */
  onLaunch: (command: string, cwd: string | undefined) => void
  /** Bring the pane of a still-running bookmarked session forward. */
  onShowTab: (tabId: string) => void
  /** A pinned workspace's fresh-agent command, e.g. `claude-work`. */
  launchCommandFor: (pin: AgentWorkspacePin) => string | null
}

const iconBtnClass =
  'flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-theme-dim hover:text-theme-fg hover:bg-white/10 transition-colors'
const revealOnHover = 'opacity-0 group-hover:opacity-100 group-hover/folder:opacity-100 focus:opacity-100'

function openFolder(cwd: string | undefined) {
  if (cwd) void window.omnitermAPI?.app?.openInSystem?.(cwd)
}

function StateChip({ session }: { session: StoredAgentSession }) {
  const [label, tone] = session.state === 'active'
    ? ['Running', 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25']
    : session.state === 'interrupted'
      ? ['Interrupted', 'text-amber-400 bg-amber-500/10 border-amber-500/25']
      : ['Saved', 'text-theme-accent bg-theme-accent/10 border-theme-accent/25']
  return (
    <span className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium border leading-tight ${tone}`}>
      {label}
    </span>
  )
}

function SessionRow({ session, onLaunch, onShowTab }: { session: StoredAgentSession } & Pick<BookmarksPanelProps, 'onLaunch' | 'onShowTab'>) {
  const command = resumeCommandFor(session)
  const runningTabId = session.state === 'active' ? session.tabId : undefined
  const bookmarked = isBookmarked(session)
  const title = session.title ?? session.folderName ?? 'Untitled session'

  return (
    <li
      className="group relative flex items-center gap-2 rounded-lg border border-theme-border/30 bg-theme-bg/40 hover:bg-theme-bg/80 hover:border-theme-border/70 px-2 py-1.5 transition-colors"
      data-testid="bookmark-session-row"
    >
      {bookmarked ? (
        <Bookmark className="w-3.5 h-3.5 flex-shrink-0 text-theme-accent" fill="currentColor" aria-label="Bookmarked" />
      ) : (
        <span className="w-3.5 flex-shrink-0" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-theme-fg" title={title}>{title}</span>
        <div className="flex items-center gap-1.5 text-[10px] text-theme-dim">
          <StateChip session={session} />
          <span className="truncate font-mono text-[10px] text-theme-dim/80" title={session.sessionId}>
            #{session.sessionId.slice(0, 8)}
          </span>
          <span className="text-theme-dim/60">·</span>
          <span className="text-theme-dim/70 truncate">{formatTimeAgo(session.updatedAt)}</span>
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        {runningTabId ? (
          <Tooltip content="Show its terminal" placement="left">
            <button
              type="button"
              className={`${iconBtnClass} text-emerald-400 hover:text-emerald-300`}
              aria-label={`Show ${title}`}
              onClick={() => onShowTab(runningTabId)}
            >
              <SquareTerminal className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={command ? `Resume: ${command}` : 'Cannot build a resume command'} placement="left">
            <button
              type="button"
              className={`${iconBtnClass} hover:text-theme-accent`}
              aria-label={`Resume ${title}`}
              disabled={!command}
              onClick={() => command && onLaunch(command, session.cwd)}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
        <Tooltip content={bookmarked ? 'Remove bookmark' : 'Remove from list'} placement="left">
          <button
            type="button"
            className={`${iconBtnClass} ${revealOnHover} hover:text-rose-400 hover:bg-rose-500/10`}
            aria-label={bookmarked ? `Remove bookmark ${title}` : `Remove ${title}`}
            onClick={() => bookmarked ? setSessionBookmarked(session.id, false) : removeStoredSession(session.id)}
          >
            {bookmarked ? <BookmarkX className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
      </div>
    </li>
  )
}

function FolderSection({
  folder,
  profileName,
  launcher,
  ...actions
}: {
  folder: FolderGroup
  profileName: string
  launcher?: string
} & Pick<BookmarksPanelProps, 'onLaunch' | 'onShowTab'>) {
  const cwd = folder.cwd
  return (
    <div className="rounded-xl border border-theme-border/40 bg-theme-bg/20 p-2 flex flex-col gap-1.5 shadow-sm">
      <div className="group/folder flex items-center gap-1.5 px-1 py-0.5 text-theme-dim">
        <Folder className="w-3.5 h-3.5 flex-shrink-0 text-theme-accent/80" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium text-theme-fg"
          title={folder.cwd ?? folder.folderName}
        >
          {folder.folderName}
        </span>
        {cwd && (
          <div className="flex items-center gap-0.5">
            <Tooltip content={folder.pinned ? 'Unpin workspace' : 'Pin this profile + folder for one-click launch'} placement="left">
              <button
                type="button"
                className={`${iconBtnClass} ${folder.pinned ? 'text-theme-accent' : revealOnHover}`}
                aria-label={folder.pinned ? `Unpin ${folder.folderName}` : `Pin ${folder.folderName}`}
                onClick={() => togglePin({ agent: folder.sessions[0]?.agent ?? 'claude', profileName, launcher, cwd, folderName: folder.folderName })}
              >
                {folder.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
            </Tooltip>
            <Tooltip content="Open folder in Explorer" placement="left">
              <button
                type="button"
                className={`${iconBtnClass} ${revealOnHover}`}
                aria-label={`Open ${folder.folderName}`}
                onClick={() => openFolder(cwd)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {folder.sessions.map((session) => (
          <SessionRow key={session.id} session={session} {...actions} />
        ))}
      </ul>
    </div>
  )
}

/**
 * The Bookmarks side panel: pinned agent workspaces for one-click launch, then every session worth
 * coming back to — bookmarked (running or saved) and interrupted — grouped by profile and folder.
 */
export default function BookmarksPanel({ onLaunch, onShowTab, launchCommandFor }: BookmarksPanelProps) {
  const [query, setQuery] = useState('')
  const sessions = useStoredSessions()
  const allPins = usePins()
  const pins = filterPins(allPins, query)
  const groups = groupBookmarks(sessions, allPins, query)
  const empty = groups.length === 0 && pins.length === 0

  return (
    <div className="flex h-full flex-col text-theme-fg select-none" data-testid="bookmarks-panel">
      {/* Search Header */}
      <div className="border-b border-theme-border/70 p-2.5">
        <label className="flex items-center gap-2 rounded-xl border border-theme-border/60 bg-theme-bg/50 px-2.5 py-1.5 focus-within:border-theme-accent focus-within:ring-1 focus-within:ring-theme-accent/30 transition-all">
          <Search className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bookmarks..."
            aria-label="Search bookmarks"
            className="min-w-0 flex-1 bg-transparent text-xs text-theme-fg placeholder:text-theme-dim/60 outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-0.5 rounded text-theme-dim hover:text-theme-fg"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </label>
      </div>

      {/* Bookmarks List */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-3.5">
        {empty && (
          <div className="flex flex-col items-center gap-2.5 px-4 py-12 text-center text-xs text-theme-dim">
            <div className="w-10 h-10 rounded-2xl bg-theme-bg/60 border border-theme-border/50 flex items-center justify-center text-theme-accent/70">
              <Bookmark className="w-5 h-5" />
            </div>
            <span className="font-semibold text-theme-fg text-sm">{query ? 'No matching bookmarks' : 'No bookmarks yet'}</span>
            {!query && (
              <span className="leading-relaxed text-[11px] text-theme-dim max-w-[220px]">
                Click the bookmark icon next to an AI agent's title in its terminal header. Sessions interrupted by a crash or a closed window also appear here.
              </span>
            )}
          </div>
        )}

        {/* Pinned Workspaces */}
        {pins.length > 0 && (
          <section aria-label="Pinned workspaces" className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Pin className="w-3 h-3 text-theme-accent" />
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-dim">Pinned workspaces</h3>
              <span className="ml-auto rounded-full bg-theme-border/50 px-1.5 py-0.2 text-[9px] font-semibold text-theme-dim">
                {pins.length}
              </span>
            </div>

            <ul className="flex flex-col gap-1">
              {pins.map((pin) => {
                const command = launchCommandFor(pin)
                return (
                  <li
                    key={pin.id}
                    className="group relative flex items-center gap-2 rounded-xl border border-theme-border/40 bg-theme-bg/30 hover:bg-theme-bg/70 hover:border-theme-accent/40 p-2 transition-all shadow-sm"
                  >
                    <AgentBadge agent={pin.agent} profileName={pin.profileName} placement="right" />
                    <button
                      type="button"
                      disabled={!command}
                      onClick={() => command && onLaunch(command, pin.cwd)}
                      className="min-w-0 flex-1 flex flex-col text-left disabled:opacity-50"
                      aria-label={`Open ${pin.profileName} in ${pin.folderName ?? pin.cwd}`}
                    >
                      <span className="truncate text-xs font-semibold text-theme-fg">{pin.folderName ?? pin.cwd}</span>
                      <span className="truncate text-[10px] font-mono text-theme-dim/80" title={pin.cwd}>
                        {command ?? pin.profileName}
                      </span>
                    </button>
                    <Tooltip content="Unpin" placement="left">
                      <button
                        type="button"
                        className={`${iconBtnClass} ${revealOnHover} hover:text-theme-accent`}
                        aria-label={`Unpin ${pin.folderName ?? pin.cwd}`}
                        onClick={() => removePin(pin.id)}
                      >
                        <PinOff className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Saved & Interrupted Groups */}
        {groups.map((group) => {
          const totalSessions = group.folders.reduce((count, folder) => count + folder.sessions.length, 0)
          return (
            <section
              key={`${group.agent ?? 'claude'}:${group.profileName}`}
              aria-label={`Profile ${group.profileName}`}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-1.5 px-1 text-theme-dim">
                <AgentBadge agent={group.agent ?? 'claude'} profileName={group.profileName} placement="right" />
                <span className="truncate text-xs font-bold font-mono text-theme-fg">{group.profileName}</span>
                <span className="ml-auto rounded-full bg-theme-border/50 px-1.5 py-0.2 text-[9px] font-semibold text-theme-dim">
                  {totalSessions}
                </span>
              </div>

              {group.folders.map((folder) => (
                <FolderSection
                  key={folder.key}
                  folder={folder}
                  profileName={group.profileName}
                  launcher={group.launcher}
                  onLaunch={onLaunch}
                  onShowTab={onShowTab}
                />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
