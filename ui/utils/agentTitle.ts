/**
 * agentTitle.ts — detect AI agent context and working folder from terminal titles.
 *
 * Shells and agents emit OSC 0/2 title escapes whenever the working directory
 * or running program changes. Well-behaved agents (Claude Code, Antigravity, Aider,
 * Cursor, Copilot CLI, etc.) include their name in the title alongside the
 * working path. This module parses those patterns without touching the backend.
 *
 * System directory paths (such as C:\Windows\System32\cmd.exe or /bin/bash) are
 * filtered out so that system executable paths are never mistaken for user project folders.
 */

export interface AgentContext {
  /** Display name of the detected agent, e.g. "Claude Code" or "Antigravity". */
  agentName: string
  /**
   * The last path segment of the working directory extracted from the title,
   * e.g. "my-project". Null when no path is present in the title.
   */
  folderName: string | null
}

const SYSTEM_DIR_NAMES = new Set([
  'system32',
  'syswow64',
  'windowspowershell',
  'v1.0',
  'windows',
  'winnt',
  'program files',
  'program files (x86)',
  'bin',
  'usr',
  'sbin',
  'lib',
  'lib64',
  'etc',
  'powershell',
  'pwsh',
  'cmd',
])

const SHELL_BINARIES = new Set([
  'cmd.exe',
  'cmd',
  'powershell.exe',
  'powershell',
  'pwsh.exe',
  'pwsh',
  'bash.exe',
  'bash',
  'zsh.exe',
  'zsh',
  'sh.exe',
  'sh',
  'wsl.exe',
  'wsl',
  'conhost.exe',
  'conhost',
  'openconsole.exe',
  'openconsole',
  'windowspowershell',
  'windows powershell',
  'powershell 7',
])

/**
 * Known AI agents, ordered from most- to least-specific.
 */
const AGENTS: ReadonlyArray<{ displayName: string; aliases: string[] }> = [
  { displayName: 'OpenCode', aliases: ['opencode', 'open-code', 'open code'] },
  { displayName: 'Claude Code', aliases: ['claude code', 'claude-code', 'claude'] },
  { displayName: 'Antigravity CLI', aliases: ['antigravity-cli', 'antigravity cli', 'antigravity', 'agy', 'google antigravity'] },
  { displayName: 'Codex', aliases: ['codex cli', 'codex-cli', 'codex'] },
  { displayName: 'Aider', aliases: ['aider'] },
  { displayName: 'Cursor Agent', aliases: ['cursor agent', 'cursor'] },
  { displayName: 'Copilot CLI', aliases: ['copilot cli', 'copilot'] },
  { displayName: 'Continue', aliases: ['continue dev', 'continue'] },
  { displayName: 'Cline', aliases: ['cline'] },
  { displayName: 'Goose', aliases: ['goose'] },
  { displayName: 'Devin', aliases: ['devin'] },
  { displayName: 'SWE-Agent', aliases: ['swe-agent', 'sweagent'] },
  { displayName: 'Gemini CLI', aliases: ['gemini cli', 'gemini'] },
]

/**
 * Attempt to extract the last meaningful folder/directory segment from a path or title string.
 *
 * Accepts both forward- and back-slash paths. Filters out system directory names
 * (e.g. system32, Windows, bin) and shell executables (.exe, .cmd, etc.).
 */
export function extractFolder(title?: string | null): string | null {
  if (!title) return null
  let trimmed = title.trim()
  if (!trimmed) return null

  // Remove common prefix like "Administrator: ", "Admin: "
  trimmed = trimmed.replace(/^(?:Administrator|Admin):\s*/i, '')

  if (SHELL_BINARIES.has(trimmed.toLowerCase())) return null

  const normalized = trimmed.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length > 0) {
    let idx = segments.length - 1

    while (idx >= 0) {
      const seg = segments[idx].toLowerCase().trim()
      if (
        SHELL_BINARIES.has(seg) ||
        /\.(exe|cmd|bat|sh|ps1)$/i.test(seg) ||
        SYSTEM_DIR_NAMES.has(seg) ||
        /^[a-z]:$/i.test(seg) ||
        /^\d+(\.\d+)*$/.test(seg)
      ) {
        idx--
      } else {
        break
      }
    }

    if (idx >= 0) {
      const found = segments[idx].replace(/^[–—\-|]+|[–—\-|]+$/g, '').trim()
      if (found.length > 0 && !SYSTEM_DIR_NAMES.has(found.toLowerCase())) {
        return found
      }
    }

    if (segments.length === 1 && /^[a-zA-Z]:$/i.test(segments[0])) {
      return `${segments[0]}\\`
    }
  }

  if (
    !SYSTEM_DIR_NAMES.has(trimmed.toLowerCase()) &&
    !SHELL_BINARIES.has(trimmed.toLowerCase())
  ) {
    const wordMatch = trimmed.match(/(?:^|[\s:–—\-|])([A-Za-z0-9_.+-]{2,60})\s*$/)
    if (wordMatch) {
      const word = wordMatch[1]
      if (
        !SYSTEM_DIR_NAMES.has(word.toLowerCase()) &&
        !SHELL_BINARIES.has(word.toLowerCase())
      ) {
        return word
      }
    }
  }

  return null
}

/**
 * Parse a terminal title and return agent context when an AI agent is detected.
 */
export function parseAgentTitle(title?: string | null): AgentContext | null {
  if (!title) return null
  const lower = title.toLowerCase()

  for (const agent of AGENTS) {
    const matched = agent.aliases.some(alias => {
      const idx = lower.indexOf(alias)
      if (idx === -1) return false
      const before = idx === 0 ? '' : lower[idx - 1]
      const after = idx + alias.length >= lower.length ? '' : lower[idx + alias.length]
      const isBeforeBoundary = !before || /[\s:–—\-|/\\@[\]()_.]/.test(before)
      const isAfterBoundary = !after || /[\s:–—\-|/\\@[\]()_.]/.test(after)
      return isBeforeBoundary && isAfterBoundary
    })
    if (!matched) continue

    let remainder = title
    for (const alias of agent.aliases) {
      const idx = lower.indexOf(alias)
      if (idx !== -1) {
        remainder = title.slice(idx + alias.length)
        break
      }
    }
    remainder = remainder.replace(/^[\s:–—\-|]+/, '')

    const folderName = remainder.length > 0 ? extractFolder(remainder) : null
    return { agentName: agent.displayName, folderName }
  }

  return null
}

export interface FormattedTerminalTitle {
  /** True when the title corresponds to a known AI agent session. */
  isAgent: boolean
  /** Friendly agent name, e.g. "Claude Code" or "Antigravity". */
  agentName?: string
  /** Extracted directory/folder name (not full path). */
  folderName?: string
  /** Shell label, e.g. "cmd", "PowerShell", "bash". */
  shellLabel?: string
  /** The final display title formatted for tabs and headers. */
  displayTitle: string
}

/**
 * Format terminal title:
 * - AI agent: `{AI agent name} - {Folder name} // {shell}` (or `{AI agent name} // {shell}` if no folder)
 * - Plain terminal: `{Folder name} // {shell}` (or `{Folder name}` if no shell)
 */
export function formatTerminalTitle(
  rawTitle?: string,
  shellLabel?: string,
  fallbackName?: string,
  fallbackCwd?: string,
): FormattedTerminalTitle {
  const title = rawTitle?.trim() || ''
  const fallbackFolder = extractFolder(fallbackCwd) || extractFolder(fallbackName)

  const agentCtx = parseAgentTitle(title) || parseAgentTitle(fallbackName)
  if (agentCtx) {
    const folder = agentCtx.folderName || fallbackFolder || 'workspace'
    const agentPart = `${agentCtx.agentName} - ${folder}`
    const displayTitle = shellLabel ? `${agentPart} // ${shellLabel}` : agentPart
    return {
      isAgent: true,
      agentName: agentCtx.agentName,
      folderName: folder,
      shellLabel,
      displayTitle,
    }
  }

  const folder = extractFolder(title) || fallbackFolder

  if (!folder) {
    const displayTitle = title || (shellLabel ? `// ${shellLabel}` : fallbackName?.trim() || 'Terminal')
    return {
      isAgent: false,
      shellLabel,
      displayTitle,
    }
  }

  const displayTitle = shellLabel && !folder.toLowerCase().includes(shellLabel.toLowerCase())
    ? `${folder} // ${shellLabel}`
    : folder

  return {
    isAgent: false,
    folderName: folder,
    shellLabel,
    displayTitle,
  }
}
