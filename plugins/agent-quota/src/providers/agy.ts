import path from 'node:path'

import type { ProviderDeps } from '../deps'
import type { FetchUsageRequest, QuotaSnapshot } from '../types'

import { isAgyModelMatch, parseAgyUsage, type AgyModelFamily } from '../agyUsageParser'
import { agentCommand } from '../launcher'

const USAGE_TIMEOUT_MS = 45_000

/** Trim a sample of unrecognised output for the diagnostics log, masking anything token-shaped. */
export function redactSample(text: string): string {
  return text
    .slice(0, 1024)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b(?:sk-[\w-]{8,}|[A-Za-z0-9_-]{32,})\b/g, '<redacted>')
}

export async function detectAgyActiveFamily(
  profileDir: string | null | undefined,
  deps: ProviderDeps,
): Promise<AgyModelFamily | null> {
  const defaultDir = path.join(deps.home, '.gemini')
  const baseDir = profileDir || defaultDir
  const candidateFiles = [
    path.join(baseDir, 'antigravity-cli', 'settings.json'),
    path.join(baseDir, 'settings.json'),
    path.join(deps.home, '.gemini', 'antigravity-cli', 'settings.json'),
    path.join(deps.home, '.gemini', 'settings.json'),
  ]

  for (const file of candidateFiles) {
    try {
      const content = await deps.readTail(file, 4096)
      if (!content) continue
      const data = JSON.parse(content) as Record<string, unknown>
      const model = typeof data.model === 'string' ? data.model : null
      if (model) {
        if (isAgyModelMatch(model, 'gemini')) return 'gemini'
        if (isAgyModelMatch(model, 'claude')) return 'claude'
      }
    } catch {}
  }
  return null
}

/**
 * Antigravity CLI (agy) usage from the CLI's `/usage` command: `agy -p /usage`.
 *
 * Runs non-interactively in print mode. The command requires a timeout of at least 30 seconds
 * (configured here as 45s) due to upstream quota fetch latency.
 */
export async function fetchAgyUsage(
  request: Pick<FetchUsageRequest, 'profileDir' | 'launcher' | 'modelFamily'>,
  deps: ProviderDeps,
): Promise<QuotaSnapshot> {
  const command = agentCommand('agy', request, deps)
  if (!command) return { windows: [], fetchedAt: deps.now(), error: 'unsupported', message: 'Antigravity CLI not found.' }

  const activeFamily: AgyModelFamily | null =
    request.modelFamily === 'gemini' || request.modelFamily === 'claude'
      ? request.modelFamily
      : await detectAgyActiveFamily(request.profileDir, deps)

  let lastError: QuotaSnapshot = { windows: [], fetchedAt: deps.now(), error: 'failed', message: 'agy -p /usage did not run.' }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.run(command.exe, ['-p', '/usage'], { env: command.env, timeoutMs: USAGE_TIMEOUT_MS, cwd: deps.tmp })
    const now = deps.now()

    if (result.timedOut) {
      lastError = { windows: [], fetchedAt: now, error: 'timeout', message: 'agy -p /usage timed out.' }
      continue
    }

    const output = `${result.stdout}\n${result.stderr}`
    const parsed = parseAgyUsage(output, now, activeFamily)
    if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }

    lastError = { windows: [], fetchedAt: now, error: parsed.error, message: parsed.message }
    if (parsed.error === 'not_signed_in') return lastError
    if (attempt === 1) deps.log(`[agent-quota] unrecognised agy -p /usage output: ${redactSample(output)}`)
  }

  return lastError
}
