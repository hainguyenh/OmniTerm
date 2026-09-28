import type { ClaudeUsageParse } from './claudeUsageParser'

import { parseClaudeUsage } from './claudeUsageParser'

/**
 * Parse the card Codex's interactive `/status` draws, e.g.
 *
 *   Context window:  98% left (5K used / 272K)
 *   5h limit:        [███████░░░░░░░░░░░░░] 35% used (resets 18:40)
 *   Weekly limit:    [██░░░░░░░░░░░░░░░░░░] 88% left (resets 09:15 on 2 Oct)
 *
 * The limit rows follow the label-first rules of Claude's `/usage` (claudeUsageParser.ts), so the
 * text is only reshaped for them: the `Session:` id and the context-window row are dropped (their
 * label or percentage would otherwise be read as the session window), and the reset loses its
 * parentheses, which parseResetText would take for a time zone.
 */
const NOT_QUOTA_ROW = /^[\s│┃|]*(?:session|context\s+window|token\s+usage)\b/i

export function parseCodexStatus(raw: string, now: number = Date.now()): ClaudeUsageParse {
  const text = raw
    .split('\n')
    .filter((line) => !NOT_QUOTA_ROW.test(line))
    .join('\n')
    .replace(/\(\s*(resets?\b[^)]*)\)/gi, '$1')
  const parsed = parseClaudeUsage(text, now)
  if (parsed.ok) return parsed
  return parsed.error === 'not_signed_in'
    ? { ...parsed, message: 'Codex is not signed in for this profile.' }
    : { ...parsed, message: 'The /status output named no session window.' }
}
