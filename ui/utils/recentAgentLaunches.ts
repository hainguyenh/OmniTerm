/**
 * The last agents started from the session picker, with the project each ran in, so the picker can
 * offer them again in one click ("claude-work · OmniTerm"). A new session is started, never a
 * resumed one, so no session id is kept.
 *
 * The command ends up in a shell, so an entry is kept only when it is one of the picker's own agent
 * commands or a profile launcher name; anything else read back from storage is dropped.
 */
import { useSyncExternalStore } from 'react'

import { isValidLauncher } from './agentSessionDetector'
import { QUICK_START_AGENTS } from './sessionQuickStart'

export interface RecentAgentLaunch {
  /** Shell command that started the agent: `claude`, `codex`, or a launcher such as `claude-work`. */
  command: string
  /** Working directory (a project folder) it started in. */
  cwd: string
  at: number
}

const STORAGE_KEY = 'omniterm:recent-agent-launches'
const CHANGE_EVENT = 'omniterm:recent-agent-launches-changed'
export const MAX_RECENT_LAUNCHES = 5
const MAX_CWD_LENGTH = 1024

const AGENT_COMMANDS = new Set(QUICK_START_AGENTS.flatMap((agent) => (agent.command ? [agent.command] : [])))

const isAgentCommand = (value: unknown): value is string =>
  typeof value === 'string' && (AGENT_COMMANDS.has(value) || isValidLauncher(value))

/** A folder as the picker keys its projects: no trailing separator, case-insensitive. */
export const folderKey = (cwd: string): string => cwd.replace(/[/\\]+$/, '').toLowerCase()

function isLaunch(value: unknown): value is RecentAgentLaunch {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return isAgentCommand(entry.command)
    && typeof entry.cwd === 'string' && entry.cwd.length > 0 && entry.cwd.length <= MAX_CWD_LENGTH
    && typeof entry.at === 'number' && Number.isFinite(entry.at)
}

let cache: RecentAgentLaunch[] | null = null

export function loadRecentLaunches(): RecentAgentLaunch[] {
  if (cache) return cache
  let parsed: unknown = []
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    parsed = []
  }
  cache = (Array.isArray(parsed) ? parsed.filter(isLaunch) : []).slice(0, MAX_RECENT_LAUNCHES)
  return cache
}

/** Puts this agent and folder first; the same pair started again moves up instead of repeating. */
export function recordAgentLaunch(command: string, cwd: string, at = Date.now()): void {
  const entry = { command, cwd, at }
  if (!isLaunch(entry)) return
  const rest = loadRecentLaunches().filter((item) => item.command !== command || folderKey(item.cwd) !== folderKey(cwd))
  const next = [entry, ...rest].slice(0, MAX_RECENT_LAUNCHES)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or unavailable: the list just stays as it was in this window.
  }
  cache = next
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

const NONE: RecentAgentLaunch[] = []

export function useRecentLaunches(): RecentAgentLaunch[] {
  return useSyncExternalStore(subscribe, loadRecentLaunches, () => NONE)
}

/** Drops the cached list, so the next read sees what tests put in storage. */
export function resetRecentLaunchesForTests(): void {
  cache = null
}
