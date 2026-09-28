/**
 * The work item an AI agent is on, read from the terminal title it sets.
 *
 * Claude Code titles its terminal with a status glyph plus a short summary of the current task —
 * `✳ Fix header status` when idle, a braille or star spinner (`⠐`, `✶`, `✻` …) while it works —
 * and falls back to its own name (`✳ Claude Code`) before a task exists. Only the task summary is a
 * work item: an agent name, a shell name or a path says nothing the header doesn't already show.
 */
import { isShellBinaryName, startsWithAgentName } from './agentTitle'

/** Leading status/spinner glyphs agents prefix their titles with. */
const STATUS_PREFIX = /^[\s\u2800-\u28ff\u2722-\u274b\u2605\u2606\u00b7\u2022*\u23fa\u25cf\u25cb\u25d0-\u25d3]+/u
const MAX_LENGTH = 120

export function extractAgentWorkItem(title?: string | null): string | undefined {
  if (!title) return undefined
  const text = title.replace(STATUS_PREFIX, '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  if (isShellBinaryName(text) || startsWithAgentName(text)) return undefined
  // A path (C:\repo, /home/me, ~/x) or a bare executable is a shell title, not a task.
  if (/^[a-z]:[\\/]|^[\\/~]|[\\/].*[\\/]/i.test(text) || /\.(exe|cmd|bat|ps1|sh)$/i.test(text)) return undefined
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}

/**
 * True when a work item only names the pane's folder. Some agents (and shell prompts that outlive
 * the agent's first title) title the terminal with the folder basename; shown as the work item it
 * repeated the folder on both sides of the bookmark.
 */
export function namesFolder(workItem: string, folders: ReadonlyArray<string | undefined>): boolean {
  const item = workItem.trim().toLowerCase()
  return folders.some((folder) => {
    const name = folder?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.trim().toLowerCase()
    return Boolean(name) && name === item
  })
}
