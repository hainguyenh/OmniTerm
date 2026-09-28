import type { ProviderDeps } from '../deps'
import type { FetchUsageRequest, QuotaSnapshot } from '../types'

import { parseClaudeUsage } from '../claudeUsageParser'
import { agentCommand } from '../launcher'

const USAGE_TIMEOUT_MS = 40_000

/** Trim a sample of unrecognised output for the diagnostics log, masking anything token-shaped. */
export function redactSample(text: string): string {
  return text
    .slice(0, 1024)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b(?:sk-[\w-]{8,}|[A-Za-z0-9_-]{32,})\b/g, '<redacted>')
}

/**
 * Claude usage from the CLI's own `/usage` command, run exactly as the user runs the profile:
 * through its launcher (`claude-th -p /usage`) when the terminal used one, otherwise `claude` with
 * the profile's `CLAUDE_CONFIG_DIR`. The CLI does its own sign-in; this reads no token and makes no
 * request of its own. Output that cannot be read is retried once and then reported as
 * `parse_failed` — never as zero usage.
 */
export async function fetchClaudeUsage(request: Pick<FetchUsageRequest, 'profileDir' | 'launcher'>, deps: ProviderDeps): Promise<QuotaSnapshot> {
  const command = agentCommand('claude', request, deps)
  if (!command) return { windows: [], fetchedAt: deps.now(), error: 'unsupported', message: 'Claude Code CLI not found.' }
  let lastError: QuotaSnapshot = { windows: [], fetchedAt: deps.now(), error: 'failed', message: 'claude /usage did not run.' }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.run(command.exe, ['-p', '/usage'], { env: command.env, timeoutMs: USAGE_TIMEOUT_MS, cwd: deps.tmp })
    const now = deps.now()
    if (result.timedOut) {
      lastError = { windows: [], fetchedAt: now, error: 'timeout', message: 'claude /usage timed out.' }
      continue
    }
    const output = `${result.stdout}\n${result.stderr}`
    const parsed = parseClaudeUsage(output, now)
    if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }
    lastError = { windows: [], fetchedAt: now, error: parsed.error, message: parsed.message }
    if (parsed.error === 'not_signed_in') return lastError
    if (attempt === 1) deps.log(`[agent-quota] unrecognised claude /usage output: ${redactSample(output)}`)
  }
  return lastError
}
