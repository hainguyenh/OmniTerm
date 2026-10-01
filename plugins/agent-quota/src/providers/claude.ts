import path from 'node:path'

import type { ProviderDeps } from '../deps'
import type { FetchUsageRequest, QuotaSnapshot, QuotaWindow } from '../types'

import { parseClaudeUsage } from '../claudeUsageParser'
import { agentCommand } from '../launcher'

const USAGE_TIMEOUT_MS = 8_000

/** Trim a sample of unrecognised output for the diagnostics log, masking anything token-shaped. */
export function redactSample(text: string): string {
  return text
    .slice(0, 1024)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b(?:sk-[\w-]{8,}|[A-Za-z0-9_-]{32,})\b/g, '<redacted>')
}

interface CachedUsageDoc {
  fetchedAtMs?: number
  cachedUsageUtilization?: {
    five_hour?: { utilization?: number | null; resets_at?: string | null }
    seven_day?: { utilization?: number | null; resets_at?: string | null }
    extra_usage?: { monthly_limit?: number | null; used_credits?: number | null; is_enabled?: boolean }
  }
  projects?: Record<string, { hasTrustDialogAccepted?: boolean }>
}

function parseCachedUsage(raw: string | null, now: number): QuotaSnapshot | null {
  if (!raw) return null
  try {
    const doc = JSON.parse(raw) as CachedUsageDoc
    const u = doc.cachedUsageUtilization
    if (!u) return null
    const windows: QuotaWindow[] = []
    if (typeof u.five_hour?.utilization === 'number') {
      const resetsAt = u.five_hour.resets_at ? Date.parse(u.five_hour.resets_at) : undefined
      windows.push({
        kind: 'session',
        label: '5-hour limit',
        usedPct: u.five_hour.utilization,
        ...(resetsAt && !Number.isNaN(resetsAt) ? { resetsAt } : {}),
      })
    }
    if (typeof u.seven_day?.utilization === 'number') {
      const resetsAt = u.seven_day.resets_at ? Date.parse(u.seven_day.resets_at) : undefined
      windows.push({
        kind: 'weekly',
        label: 'Weekly limit',
        usedPct: u.seven_day.utilization,
        ...(resetsAt && !Number.isNaN(resetsAt) ? { resetsAt } : {}),
      })
    }
    if (windows.length === 0) return null
    const credits = u.extra_usage && typeof u.extra_usage.monthly_limit === 'number'
      ? {
          balance: Math.max(0, u.extra_usage.monthly_limit - (u.extra_usage.used_credits ?? 0)),
          unlimited: false,
        }
      : undefined
    return {
      windows,
      fetchedAt: doc.fetchedAtMs ?? now,
      source: 'cli',
      ...(credits ? { credits } : {}),
    }
  } catch {
    return null
  }
}

function findTrustedDir(raw: string | null, fallback: string): string {
  if (!raw) return fallback
  try {
    const doc = JSON.parse(raw) as CachedUsageDoc
    if (doc.projects) {
      for (const [dir, p] of Object.entries(doc.projects)) {
        if (p?.hasTrustDialogAccepted === true) return dir
      }
    }
  } catch {
    // ignore
  }
  return fallback
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

  const configPath = request.profileDir
    ? path.join(request.profileDir, '.claude.json')
    : path.join(deps.home, '.claude.json')
  const configRaw = await deps.readTail(configPath, 1_000_000).catch(() => null)
    ?? (request.profileDir ? await deps.readTail(path.join(deps.home, '.claude.json'), 1_000_000).catch(() => null) : null)
  const cwd = findTrustedDir(configRaw, deps.tmp)

  let lastError: QuotaSnapshot = { windows: [], fetchedAt: deps.now(), error: 'failed', message: 'claude /usage did not run.' }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.run(command.exe, ['-p', '/usage'], { env: command.env, timeoutMs: USAGE_TIMEOUT_MS, cwd })
    const now = deps.now()
    if (result.timedOut) {
      lastError = { windows: [], fetchedAt: now, error: 'timeout', message: 'claude /usage timed out.' }
      break
    }
    const output = `${result.stdout}\n${result.stderr}`
    const parsed = parseClaudeUsage(output, now)
    if (parsed.ok) return { windows: parsed.windows, fetchedAt: now, source: 'cli' }
    lastError = { windows: [], fetchedAt: now, error: parsed.error, message: parsed.message }
    if (parsed.error === 'not_signed_in') return lastError
    if (attempt === 1) deps.log(`[agent-quota] unrecognised claude /usage output: ${redactSample(output)}`)
  }

  const cached = parseCachedUsage(configRaw, deps.now())
  if (cached) return cached

  return lastError
}
