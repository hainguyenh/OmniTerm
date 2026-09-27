import type { ProviderDeps } from './deps'
import type { AgentKind, FetchUsageRequest, QuotaSnapshot, WakeRequest, WakeResult } from './types'

import { createNodeDeps } from './deps'
import { isLauncherName } from './launcher'
import { fetchClaudeUsage } from './providers/claude'
import { fetchCodexUsage } from './providers/codex'
import { wakeAgent } from './wake'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

type Host = {
  registerInvokeHandler(handler: InvokeHandler): void
  services: { log(message: string): void }
}

export const name = '@omniterm/agent-quota'

const AGENTS: readonly AgentKind[] = ['claude', 'codex']

function isAgent(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENTS as readonly string[]).includes(value)
}

function optionalDir(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) throw new Error('Invalid profile directory')
  return value
}

/** A launcher is only ever a bare, validated name; it is resolved by the sidecar, never run as a path. */
function optionalLauncher(value: unknown, agent: AgentKind): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !isLauncherName(value, agent)) throw new Error('Invalid profile launcher')
  return value
}

/** Validate a renderer request; everything crossing the IPC boundary is untrusted. */
export function parseFetchRequest(value: unknown): FetchUsageRequest {
  const record = (value ?? {}) as Record<string, unknown>
  if (!isAgent(record.agent)) throw new Error('Unknown agent')
  return { agent: record.agent, profileDir: optionalDir(record.profileDir), launcher: optionalLauncher(record.launcher, record.agent) }
}

export function parseWakeRequest(value: unknown): WakeRequest {
  const record = (value ?? {}) as Record<string, unknown>
  if (!isAgent(record.agent)) throw new Error('Unknown agent')
  if (typeof record.prompt !== 'string') throw new Error('Missing wake prompt')
  return {
    agent: record.agent,
    profileDir: optionalDir(record.profileDir),
    launcher: optionalLauncher(record.launcher, record.agent),
    prompt: record.prompt,
  }
}

const profileKey = (request: { agent: AgentKind; profileDir?: string | null; launcher?: string | null }) =>
  `${request.agent}:${request.launcher ?? ''}:${(request.profileDir ?? '').toLowerCase()}`

/**
 * One probe per profile at a time. Two terminals on the same account ask together; the second
 * shares the first's answer instead of running `claude /usage` twice.
 */
export function createService(deps: ProviderDeps) {
  const inFlight = new Map<string, Promise<QuotaSnapshot>>()
  const waking = new Map<string, Promise<WakeResult>>()

  const fetchUsage = (request: FetchUsageRequest): Promise<QuotaSnapshot> => {
    const key = profileKey(request)
    const pending = inFlight.get(key)
    if (pending) return pending
    const run = (async () => (request.agent === 'claude'
      ? fetchClaudeUsage(request, deps)
      : fetchCodexUsage(request.profileDir, deps)))()
      .catch((error: unknown): QuotaSnapshot => ({
        windows: [],
        fetchedAt: deps.now(),
        error: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => inFlight.delete(key))
    inFlight.set(key, run)
    return run
  }

  const wake = (request: WakeRequest): Promise<WakeResult> => {
    const key = profileKey(request)
    const pending = waking.get(key)
    if (pending) return pending
    const run = wakeAgent(request, deps)
      .catch((error: unknown): WakeResult => ({ ok: false, message: error instanceof Error ? error.message : String(error) }))
      .finally(() => waking.delete(key))
    waking.set(key, run)
    return run
  }

  return { fetchUsage, wake }
}

export function activate(host: Host, deps: ProviderDeps = createNodeDeps((message) => host.services.log(message))): void {
  const service = createService(deps)
  host.registerInvokeHandler((method, ...args) => {
    if (method === 'agentQuota.info') {
      return { name: 'Agent Quota', agents: AGENTS }
    }
    if (method === 'agentQuota.fetchUsage') return service.fetchUsage(parseFetchRequest(args[0]))
    if (method === 'agentQuota.wake') return service.wake(parseWakeRequest(args[0]))
    throw new Error(`Unknown Agent Quota method "${method}"`)
  })
  host.services.log('Agent Quota activated')
}

export function deactivate(): void {}

export default { name, activate, deactivate }
