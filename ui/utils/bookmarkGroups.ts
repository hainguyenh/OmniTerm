/**
 * The Bookmarks view's model: what to list and how to group it, kept out of the component so the
 * rules are testable without rendering. Everything worth coming back to is listed — bookmarked
 * sessions (running or not) and interrupted ones — grouped by agent profile, then by folder.
 */
import type { AgentWorkspacePin } from './agentBookmarkPins'
import { pinIdFor } from './agentBookmarkPins'
import { isBookmarked, type StoredAgentSession } from './agentSessionStorage'
import { sessionFolderName } from './storedSessionResume'

export interface FolderGroup {
  /** Stable key: the pin id for this profile + folder. */
  key: string
  cwd?: string
  folderName: string
  pinned: boolean
  sessions: StoredAgentSession[]
}

export interface ProfileGroup {
  profileName: string
  launcher?: string
  folders: FolderGroup[]
}

export function isListedInBookmarks(session: StoredAgentSession): boolean {
  return isBookmarked(session) || session.state === 'interrupted'
}

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true
  return fields.some(field => field?.toLowerCase().includes(query))
}

function newest(sessions: StoredAgentSession[]): number {
  return sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), 0)
}

export function groupBookmarks(
  sessions: readonly StoredAgentSession[],
  pins: readonly AgentWorkspacePin[],
  rawQuery = '',
): ProfileGroup[] {
  const query = rawQuery.trim().toLowerCase()
  const pinned = new Set(pins.map(pin => pin.id))
  const byProfile = new Map<string, { launcher?: string; folders: Map<string, FolderGroup> }>()

  for (const session of sessions) {
    if (!isListedInBookmarks(session)) continue
    const folderName = sessionFolderName(session)
    if (!matches(query, session.title, folderName, session.cwd, session.profileName, session.launcher)) continue
    const profile = byProfile.get(session.profileName) ?? { launcher: session.launcher, folders: new Map() }
    byProfile.set(session.profileName, profile)
    const key = pinIdFor(session.profileName, session.cwd ?? folderName)
    const folder = profile.folders.get(key) ?? { key, cwd: session.cwd, folderName, pinned: pinned.has(key), sessions: [] }
    profile.folders.set(key, folder)
    folder.sessions.push(session)
  }

  return [...byProfile.entries()]
    .map(([profileName, profile]) => ({
      profileName,
      launcher: profile.launcher,
      folders: [...profile.folders.values()]
        .map(folder => ({ ...folder, sessions: [...folder.sessions].sort((a, b) => b.updatedAt - a.updatedAt) }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || newest(b.sessions) - newest(a.sessions)),
    }))
    .sort((a, b) => a.profileName.localeCompare(b.profileName))
}

export function filterPins(pins: readonly AgentWorkspacePin[], rawQuery = ''): AgentWorkspacePin[] {
  const query = rawQuery.trim().toLowerCase()
  return pins
    .filter(pin => matches(query, pin.folderName, pin.cwd, pin.profileName, pin.launcher))
    .sort((a, b) => a.profileName.localeCompare(b.profileName) || (a.folderName ?? a.cwd).localeCompare(b.folderName ?? b.cwd))
}
