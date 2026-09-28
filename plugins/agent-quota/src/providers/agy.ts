import type { ProviderDeps } from '../deps'
import type { FetchUsageRequest, QuotaSnapshot } from '../types'

import { parseAgyUsage } from '../agyUsageParser'
import { agentCommand } from '../launcher'

const USAGE_TIMEOUT_MS = 45_000

/** Trim a sample of unrecognised output for the diagnostics log, masking anything token-shaped. */
export function redactSample(text: string): string {
  return text
    .slice(0, 1024)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b(?:sk-[\w-]{8,}|[A-Za-z0-9_-]{32,})\b/g, '<redacted>')
}

/**
 * Antigravity CLI (agy) usage from the CLI's `/usage` command: `agy -p /usage`.
 *
 * Runs non-interactively in print mode. The command requires a timeout of at least 30 seconds
 * (configured here as 45s) due to upstream quota fetch latency.
 */
export async function fetchAgyUsage(
  request: Pick<FetchUsageRequest, 'profileDir' | 'launcher'>,
  deps: ProviderDeps,
): Promise<QuotaSnapshot> {
  const command = agentCommand('agy', request, deps)
  if (!command) return { windows: [], fetchedAt: deps.now(), error: 'unsupported', message: 'Antigravity CLI not found.' }

  let lastError: QuotaSnapshot = { windows: [], fetchedAt: deps.now(), error: 'failed', message: 'agy -p /usage did not run.' }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.run(command.exe, ['-p', '/usage'], { env: command.env, timeoutMs: USAGE_TIMEOUT_MS, cwd: deps.tmp })
    const now = deps.now()

    if (result.timedOut) {
      lastError = { windows: [], fetchedAt: now, error: 'timeout', message: 'agy -p /usage timed out.' }
      continue
    }

    const output = `${result.stdout}\n${result.stderr}`
    const parsed = parseAgyUsage(output, now)
    if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }

    lastError = { windows: [], fetchedAt: now, error: parsed.error, message: parsed.message }
    if (parsed.error === 'not_signed_in') return lastError
    if (attempt === 1) deps.log(`[agent-quota] unrecognised agy -p /usage output: ${redactSample(output)}`)
  }

  return lastError
}
