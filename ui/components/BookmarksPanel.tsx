import { useState } from 'react'
import { Bookmark, BookmarkX, FolderOpen, Pin, PinOff, Play, Search, SquareTerminal, X } from 'lucide-react'

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

const iconBase = 'flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover transition-colors'
const iconButton = `${iconBase} hover:text-theme-accent`
const revealOnHover = 'opacity-0 group-hover:opacity-100 focus:opacity-100'

function openFolder(cwd: string | undefined) {
  if (cwd) void window.omnitermAPI?.app?.openInSystem?.(cwd)
}

function StateChip({ session }: { session: StoredAgentSession }) {
  const [label, tone] = session.state === 'active'
    ? ['Running', 'text-emerald-400 border-emerald-400/30']
    : session.state === 'interrupted'
      ? ['Interrupted', 'text-theme-warning border-theme-warning/30']
      : ['Saved', 'text-theme-accent border-theme-accent/30']
  return <span className={`flex-shrink-0 rounded-full border px-1.5 text-[9px] leading-4 ${tone}`}>{label}</span>
}

function SessionRow({ session, onLaunch, onShowTab }: { session: StoredAgentSession } & Pick<BookmarksPanelProps, 'onLaunch' | 'onShowTab'>) {
  const command = resumeCommandFor(session)
  const runningTabId = session.state === 'active' ? session.tabId : undefined
  const bookmarked = isBookmarked(session)
  const title = session.title ?? session.folderName ?? 'Untitled session'
  return (
    <li className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-theme-hover" data-testid="bookmark-session-row">
      {bookmarked
        ? <Bookmark className="w-3 h-3 flex-shrink-0 text-theme-accent" fill="currentColor" aria-label="Bookmarked" />
        : <span className="w-3 flex-shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 flex flex-col">
        <span className="truncate text-xs text-theme-fg" title={title}>{title}</span>
        <span className="flex items-center gap-1 text-[10px] text-theme-dim">
          <StateChip session={session} />
          <span className="truncate font-mono" title={session.sessionId}>{session.sessionId.slice(0, 8)}</span>
          <span>· {formatTimeAgo(session.updatedAt)}</span>
        </span>
      </span>
      {runningTabId ? (
        <Tooltip content="Show its terminal" placement="left">
          <button type="button" className={iconButton} aria-label={`Show ${title}`} onClick={() => onShowTab(runningTabId)}>
            <SquareTerminal className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={command ? `Resume: ${command}` : 'Cannot build a resume command'} placement="left">
          <button type="button" className={iconButton} aria-label={`Resume ${title}`} disabled={!command} onClick={() => command && onLaunch(command, session.cwd)}>
            <Play className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={bookmarked ? 'Remove bookmark' : 'Remove from list'} placement="left">
        <button
          type="button"
          className={`${iconBase} ${revealOnHover} hover:text-theme-error`}
          aria-label={bookmarked ? `Remove bookmark ${title}` : `Remove ${title}`}
          onClick={() => bookmarked ? setSessionBookmarked(session.id, false) : removeStoredSession(session.id)}
        >
          {bookmarked ? <BookmarkX className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </Tooltip>
    </li>
  )
}

function FolderSection({ folder, profileName, launcher, ...actions }: { folder: FolderGroup; profileName: string; launcher?: string } & Pick<BookmarksPanelProps, 'onLaunch' | 'onShowTab'>) {
  const cwd = folder.cwd
  return (
    <div className="ml-2">
      <div className="group flex items-center gap-1 px-1 py-0.5 text-[11px] text-theme-dim">
        <span className="min-w-0 flex-1 truncate font-medium" title={folder.cwd ?? folder.folderName}>{folder.folderName}</span>
        {cwd && (
          <>
            <Tooltip content={folder.pinned ? 'Unpin workspace' : 'Pin this profile + folder for one-click launch'} placement="left">
              <button
                type="button"
                className={`${iconButton} ${folder.pinned ? 'text-theme-accent' : revealOnHover}`}
                aria-label={folder.pinned ? `Unpin ${folder.folderName}` : `Pin ${folder.folderName}`}
                onClick={() => togglePin({ agent: folder.sessions[0]?.agent ?? 'claude', profileName, launcher, cwd, folderName: folder.folderName })}
              >
                {folder.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
            </Tooltip>
            <Tooltip content="Open folder in Explorer" placement="left">
              <button type="button" className={`${iconButton} ${revealOnHover}`} aria-label={`Open ${folder.folderName}`} onClick={() => openFolder(cwd)}>
                <FolderOpen className="w-3 h-3" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      <ul className="flex flex-col">
        {folder.sessions.map(session => <SessionRow key={session.id} session={session} {...actions} />)}
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
    <div className="flex h-full flex-col text-[var(--theme-fg)] select-none" data-testid="bookmarks-panel">
      <div className="border-b border-[var(--theme-border)] px-3 py-2">
        <label className="flex items-center gap-1.5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1 focus-within:border-[var(--theme-accent)]">
          <Search className="w-3.5 h-3.5 flex-shrink-0 text-theme-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bookmarks"
            aria-label="Search bookmarks"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-3">
        {empty && (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-theme-dim">
            <Bookmark className="w-6 h-6 opacity-60" />
            <span className="font-medium text-theme-fg">{query ? 'No matching bookmarks' : 'No bookmarks yet'}</span>
            {!query && (
              <span className="leading-relaxed">
                Click the bookmark icon next to an AI agent's title in its terminal header. Sessions interrupted by a crash or a closed window also appear here.
              </span>
            )}
          </div>
        )}

        {pins.length > 0 && (
          <section aria-label="Pinned workspaces">
            <h3 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-theme-dim">Pinned workspaces</h3>
            <ul className="flex flex-col">
              {pins.map(pin => {
                const command = launchCommandFor(pin)
                return (
                  <li key={pin.id} className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-theme-hover">
                    <AgentBadge agent={pin.agent} profileName={pin.profileName} placement="right" />
                    <button
                      type="button"
                      disabled={!command}
                      onClick={() => command && onLaunch(command, pin.cwd)}
                      className="min-w-0 flex-1 flex flex-col text-left disabled:opacity-50"
                      aria-label={`Open ${pin.profileName} in ${pin.folderName ?? pin.cwd}`}
                    >
                      <span className="truncate text-xs text-theme-fg">{pin.folderName ?? pin.cwd}</span>
                      <span className="truncate text-[10px] font-mono text-theme-dim" title={pin.cwd}>{command ?? pin.profileName}</span>
                    </button>
                    <Tooltip content="Unpin" placement="left">
                      <button type="button" className={`${iconButton} ${revealOnHover}`} aria-label={`Unpin ${pin.folderName ?? pin.cwd}`} onClick={() => removePin(pin.id)}>
                        <PinOff className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {groups.map(group => (
          <section key={`${group.agent ?? 'claude'}:${group.profileName}`} aria-label={`Profile ${group.profileName}`}>
            <h3 className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-theme-dim">
              <AgentBadge agent={group.agent ?? 'claude'} profileName={group.profileName} placement="right" />
              <span className="truncate normal-case font-mono">{group.profileName}</span>
              <span className="ml-auto font-normal">{group.folders.reduce((count, folder) => count + folder.sessions.length, 0)}</span>
            </h3>
            {group.folders.map(folder => (
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
        ))}
      </div>
    </div>
  )
}
