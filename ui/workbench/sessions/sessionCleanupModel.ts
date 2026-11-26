import { invoke } from '@tauri-apps/api/core'

import type { StoredAgentSession, StoredSessionState } from '../../utils/agentSessionStorage'

/** The agents whose conversations the backend lists (`agy` is Antigravity). */
export const SESSION_AGENTS = ['claude', 'codex', 'agy'] as const
export type SessionAgentName = (typeof SESSION_AGENTS)[number]

const isSessionAgent = (value: unknown): value is SessionAgentName =>
  typeof value === 'string' && (SESSION_AGENTS as readonly string[]).includes(value)

const AGENT_LABELS: Record<SessionAgentName, string> = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' }

/** The name the dialog shows for an agent; an unknown one as it is. */
export const agentLabel = (agent: string): string => (isSessionAgent(agent) ? AGENT_LABELS[agent] : agent)

/** One agent conversation on disk, as `agent_session_files_list` reports it. */
export interface AgentSessionFile {
  id: string
  agent: SessionAgentName
  profile: string
  sessionId: string
  cwd: string | null
  title: string | null
  lastActive: number
  size: number
  /** No prompt was ever typed: the agent's resume list shows it with nothing in it. */
  empty: boolean
}

export interface DeleteReport {
  deleted: string[]
  failed: Array<[string, string]>
}

/** A row of the cleanup table: a conversation on disk, one OmniTerm remembers, or both. */
export interface CleanupRow {
  key: string
  agent: string
  profile: string
  sessionId: string
  cwd?: string
  title?: string
  lastActive: number
  /** Bytes of the transcript; null when OmniTerm remembers a session whose file is gone. */
  size: number | null
  /** Id to delete the transcript with; null without one. */
  fileId: string | null
  /** Id of OmniTerm's resume or bookmark entry; null when OmniTerm does not remember it. */
  storedId: string | null
  storedState?: StoredSessionState
  bookmarked: boolean
  /** Runs in an open pane, or its file was written moments ago: never deleted from under an agent. */
  open: boolean
  /** Its transcript holds no prompt (see `AgentSessionFile.empty`). */
  empty: boolean
}

export type CleanupSortColumn = 'lastActive' | 'agent' | 'profile' | 'size' | 'project'

export interface CleanupSort {
  column: CleanupSortColumn
  descending: boolean
}

export interface CleanupFilter {
  agent: string | 'all'
  profile: string | 'all'
  /** Only sessions idle at least this many days; 0 for any. */
  olderThanDays: number
  /** Only conversations without a prompt. */
  emptyOnly?: boolean
}

/** Whether a listing read with `scannedDays` holds every row a filter of `filterDays` shows. */
export const scanCoversAge = (scannedDays: number, filterDays: number) => scannedDays <= filterDays

/** The rows a selection can act on: never a session still running in a pane. */
export const isSelectable = (row: CleanupRow) => !row.open

/** Every selectable row of `rows` (drawn or not) when `checked`, else none. */
export const selectAllKeys = (rows: readonly CleanupRow[], checked: boolean): Set<string> =>
  new Set(checked ? rows.filter(isSelectable).map((row) => row.key) : [])

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TEXT = 4096

const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TEXT
const optionalText = (value: unknown): string | null => (isText(value) && value ? value : null)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** A listing entry from the backend, or null when it is not one (IPC data is validated here). */
export function parseSessionFile(raw: unknown): AgentSessionFile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isText(r.id) || !r.id || !isSessionAgent(r.agent)) return null
  if (!isText(r.profile) || !isText(r.sessionId) || !isCount(r.lastActive) || !isCount(r.size)) return null
  return {
    id: r.id,
    agent: r.agent,
    profile: r.profile,
    sessionId: r.sessionId,
    cwd: optionalText(r.cwd),
    title: optionalText(r.title),
    lastActive: r.lastActive,
    size: r.size,
    empty: r.empty === true,
  }
}

/** An agent profile folder on this machine; listing them reads no conversation. */
export interface SessionProfile {
  agent: AgentSessionFile['agent']
  profile: string
}

export function parseSessionProfile(raw: unknown): SessionProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isSessionAgent(r.agent) || !isText(r.profile) || !r.profile) return null
  return { agent: r.agent, profile: r.profile }
}

export async function listSessionProfiles(): Promise<SessionProfile[]> {
  const raw = await invoke<unknown>('agent_session_profiles_list')
  return Array.isArray(raw) ? raw.flatMap((item) => parseSessionProfile(item) ?? []) : []
}

/**
 * The conversations of `profiles`, read from their folders on this machine. With `olderThanDays`
 * the backend drops newer ones before it caps the listing, so a "7+ days" scan reaches the old
 * conversations even when a machine holds more than the cap.
 */
export async function listSessionFiles(profiles: readonly string[], olderThanDays = 0): Promise<AgentSessionFile[]> {
  const raw = await invoke<unknown>('agent_session_files_list', { profiles, olderThanDays })
  return Array.isArray(raw) ? raw.flatMap((item) => parseSessionFile(item) ?? []) : []
}

/** The profiles a scan with `filter` reads: the chosen one, else every profile of the chosen agent. */
export function profilesToScan(profiles: readonly SessionProfile[], filter: Pick<CleanupFilter, 'agent' | 'profile'>): string[] {
  return profiles
    .filter((item) => (filter.agent === 'all' || item.agent === filter.agent) && (filter.profile === 'all' || item.profile === filter.profile))
    .map((item) => item.profile)
}

export async function deleteSessionFiles(ids: readonly string[]): Promise<DeleteReport> {
  const raw = await invoke<unknown>('agent_session_files_delete', { ids })
  const report = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const deleted = Array.isArray(report.deleted) ? report.deleted.filter(isText) : []
  const failed = Array.isArray(report.failed)
    ? report.failed.flatMap((item): Array<[string, string]> => (Array.isArray(item) && isText(item[0]) && isText(item[1]) ? [[item[0], item[1]]] : []))
    : []
  return { deleted, failed }
}

/** Stops the running delete before its next session. */
export async function cancelSessionDelete(): Promise<void> {
  try {
    await invoke<void>('agent_session_files_delete_cancel')
  } catch {
    // Nothing running any more: the delete has ended on its own.
  }
}

/** The backend's progress event of a session delete. */
export const SESSION_PROGRESS_EVENT = 'session-cleanup:progress'

/** The listing without the conversations `deleted`: the table updates without scanning again. */
export function withoutDeleted(files: readonly AgentSessionFile[], deleted: readonly string[]): AgentSessionFile[] {
  const gone = new Set(deleted)
  return files.filter((file) => !gone.has(file.id))
}

/** A transcript written this recently may belong to an agent OmniTerm does not track (another terminal). */
export const IN_USE_MS = 10 * 60 * 1000

/**
 * Joins the conversations on disk with the sessions OmniTerm remembers (matched by agent and
 * session id), so one table shows both: a remembered session without a file still gets a row.
 */
export function mergeCleanupRows(files: readonly AgentSessionFile[], stored: readonly StoredAgentSession[], now: number): CleanupRow[] {
  const byKey = new Map(stored.map((entry) => [`${entry.agent}:${entry.sessionId}`, entry]))
  const matched = new Set<string>()
  const rows: CleanupRow[] = files.map((file) => {
    const entry = byKey.get(`${file.agent}:${file.sessionId}`)
    if (entry) matched.add(entry.id)
    return {
      key: file.id,
      agent: file.agent,
      profile: file.profile,
      sessionId: file.sessionId,
      cwd: file.cwd ?? entry?.cwd,
      title: entry?.title ?? file.title ?? undefined,
      lastActive: Math.max(file.lastActive, entry?.updatedAt ?? 0),
      size: file.size,
      fileId: file.id,
      storedId: entry?.id ?? null,
      storedState: entry?.state,
      bookmarked: Boolean(entry?.bookmarked),
      open: entry?.state === 'active' || now - file.lastActive < IN_USE_MS,
      empty: file.empty,
    }
  })
  for (const entry of stored) {
    if (matched.has(entry.id)) continue
    rows.push({
      key: `stored:${entry.id}`,
      agent: entry.agent,
      profile: entry.profileName,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      title: entry.title,
      lastActive: entry.updatedAt,
      size: null,
      fileId: null,
      storedId: entry.id,
      storedState: entry.state,
      bookmarked: Boolean(entry.bookmarked),
      open: entry.state === 'active',
      empty: false,
    })
  }
  return rows
}

export function filterCleanupRows(rows: readonly CleanupRow[], filter: CleanupFilter, now: number): CleanupRow[] {
  const cutoff = filter.olderThanDays > 0 ? now - filter.olderThanDays * DAY_MS : Infinity
  return rows.filter((row) =>
    (filter.agent === 'all' || row.agent === filter.agent)
    && (filter.profile === 'all' || row.profile === filter.profile)
    && row.lastActive <= cutoff
    && (!filter.emptyOnly || row.empty),
  )
}

/** The last folder of the working directory: what the Project column shows and sorts by. */
export function projectName(cwd: string | undefined): string {
  return cwd?.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

const sortValue = (row: CleanupRow, column: CleanupSortColumn): string | number => {
  switch (column) {
    case 'lastActive': return row.lastActive
    case 'size': return row.size ?? -1
    case 'project': return projectName(row.cwd).toLowerCase()
    default: return row[column].toLowerCase()
  }
}

/** Sorted by the column, ties broken by most recently active first. */
export function sortCleanupRows(rows: readonly CleanupRow[], sort: CleanupSort): CleanupRow[] {
  const direction = sort.descending ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.column)
    const right = sortValue(b, sort.column)
    if (left !== right) return (left < right ? -1 : 1) * direction
    return b.lastActive - a.lastActive
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** "5 min ago", "3 days ago": how long a session has been idle. */
export function formatAge(lastActive: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - lastActive) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}
