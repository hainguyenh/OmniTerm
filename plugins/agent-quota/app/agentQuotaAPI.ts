import { invoke } from '@tauri-apps/api/core'

import type { AgentKind, DiscoveredProfile, FetchUsageRequest, QuotaSnapshot, QuotaWindow, WakeRequest, WakeResult } from '../src/types'

/** The main agent Rust found in a terminal session (`agent_quota_detect`). */
export interface SessionAgent {
  sessionId: string
  agent: AgentKind
  pid: number
  startTime: number
  profileDir: string | null
  profileName: string
  subAgentCount: number
  /** The profile launcher the terminal ran (e.g. `claude-th`), when there was one. */
  launcher: string | null
}

export interface FrozenProcess {
  pid: number
  startTime: number
  image: string
}

export interface SuspendReport {
  frozen: FrozenProcess[]
  newlyFrozen: number
  errors: string[]
}

const AGENTS: readonly string[] = ['claude', 'codex', 'agy']
const LAUNCHER = /^(claude|codex|agy)-[A-Za-z0-9_.]{1,40}$/
const KINDS: readonly string[] = ['session', 'weekly', 'monthly']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Validate the detect payload; malformed rows are dropped rather than trusted. */
export function parseSessionAgents(value: unknown): SessionAgent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): SessionAgent[] => {
    if (!isRecord(row) || typeof row.sessionId !== 'string' || !AGENTS.includes(row.agent as string)) return []
    if (!isInt(row.pid) || !isInt(row.startTime) || typeof row.profileName !== 'string') return []
    return [{
      sessionId: row.sessionId,
      agent: row.agent as AgentKind,
      pid: row.pid,
      startTime: row.startTime,
      profileDir: typeof row.profileDir === 'string' ? row.profileDir : null,
      profileName: row.profileName,
      subAgentCount: isInt(row.subAgentCount) ? row.subAgentCount : 0,
      launcher: typeof row.launcher === 'string' && LAUNCHER.test(row.launcher) ? row.launcher : null,
    }]
  })
}

function parseWindow(value: unknown): QuotaWindow | null {
  if (!isRecord(value) || !KINDS.includes(value.kind as string)) return null
  const used = value.usedPct
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  const breakdown = Array.isArray(value.breakdown)
    ? value.breakdown.filter((entry): entry is { label: string; usedPct: number } =>
      isRecord(entry) && typeof entry.label === 'string' && typeof entry.usedPct === 'number')
    : undefined
  return {
    kind: value.kind as QuotaWindow['kind'],
    usedPct: Math.min(100, Math.max(0, used)),
    label: typeof value.label === 'string' ? value.label : String(value.kind),
    ...(typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt) ? { resetsAt: value.resetsAt } : {}),
    ...(breakdown && breakdown.length > 0 ? { breakdown } : {}),
  }
}

/** Validate a sidecar snapshot. Anything unreadable becomes an error snapshot the guard ignores. */
export function parseSnapshot(value: unknown, now: number = Date.now()): QuotaSnapshot {
  if (!isRecord(value)) return { windows: [], fetchedAt: now, error: 'failed', message: 'The Agent Quota plugin did not answer.' }
  const windows = Array.isArray(value.windows) ? value.windows.map(parseWindow).filter((w): w is QuotaWindow => w !== null) : []
  const snapshot: QuotaSnapshot = {
    windows,
    fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : now,
  }
  if (typeof value.source === 'string') snapshot.source = value.source as QuotaSnapshot['source']
  if (typeof value.error === 'string') snapshot.error = value.error as QuotaSnapshot['error']
  if (typeof value.message === 'string') snapshot.message = value.message.slice(0, 300)
  if (isRecord(value.credits)) {
    snapshot.credits = {
      balance: typeof value.credits.balance === 'number' ? value.credits.balance : null,
      unlimited: value.credits.unlimited === true,
    }
  }
  return snapshot
}

function parseReport(value: unknown): SuspendReport {
  const record = isRecord(value) ? value : {}
  const frozen = Array.isArray(record.frozen)
    ? record.frozen.filter((entry): entry is FrozenProcess => isRecord(entry) && isInt(entry.pid) && isInt(entry.startTime) && typeof entry.image === 'string')
    : []
  const errors = Array.isArray(record.errors) ? record.errors.filter((error): error is string => typeof error === 'string') : []
  return { frozen, newlyFrozen: isInt(record.newlyFrozen) ? record.newlyFrozen : 0, errors }
}

const count = (value: unknown) => (isInt(value) ? value : 0)

/**
 * Validate `agentQuota.listProfiles`: a launcher must be a bare name for its own agent, the name a
 * short label, the directory a plain string. Anything else is dropped, never shown or probed.
 */
export function parseDiscoveredProfiles(value: unknown): DiscoveredProfile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): DiscoveredProfile[] => {
    if (!isRecord(row) || !AGENTS.includes(row.agent as string)) return []
    const agent = row.agent as AgentKind
    if (typeof row.profileName !== 'string' || row.profileName.length === 0 || row.profileName.length > 80) return []
    const launcher = row.launcher === null || row.launcher === undefined ? null : row.launcher
    if (launcher !== null && (typeof launcher !== 'string' || !LAUNCHER.test(launcher) || !launcher.startsWith(`${agent}-`))) return []
    const profileDir = typeof row.profileDir === 'string' && row.profileDir.length <= 1024 ? row.profileDir : null
    if (launcher === null && profileDir === null) return []
    return [{ agent, profileName: row.profileName, profileDir, launcher }]
  })
}

/** Every profile the user can start (the Profiles dashboard); an absent or failing sidecar lists none. */
export function listAgentProfiles(): Promise<DiscoveredProfile[]> {
  return invoke<unknown>('plugin_invoke', { method: 'agentQuota.listProfiles', args: [] }).then(parseDiscoveredProfiles, () => [])
}

export interface AgentQuotaAPI {
  info(): Promise<boolean>
  detect(): Promise<SessionAgent[]>
  suspend(sessionId: string, pid: number, startTime: number): Promise<SuspendReport>
  resume(sessionId: string): Promise<number>
  resumeAll(): Promise<number>
  terminate(sessionId: string, pid: number, startTime: number): Promise<number>
  fetchUsage(request: FetchUsageRequest): Promise<QuotaSnapshot>
  wake(request: WakeRequest): Promise<WakeResult>
}

export function createAgentQuotaAPI(): AgentQuotaAPI {
  const plugin = (method: string, payload?: unknown) => invoke<unknown>('plugin_invoke', { method, args: payload === undefined ? [] : [payload] })
  return {
    info: () => plugin('agentQuota.info').then((info) => isRecord(info), () => false),
    detect: () => invoke<unknown>('agent_quota_detect').then(parseSessionAgents),
    suspend: (sessionId, pid, startTime) => invoke<unknown>('agent_quota_suspend', { sessionId, pid, startTime }).then(parseReport),
    resume: (sessionId) => invoke<unknown>('agent_quota_resume', { sessionId }).then(count),
    resumeAll: () => invoke<unknown>('agent_quota_resume_all').then(count),
    terminate: (sessionId, pid, startTime) => invoke<unknown>('agent_quota_terminate', { sessionId, pid, startTime }).then(count),
    fetchUsage: (request) => plugin('agentQuota.fetchUsage', request).then(
      (value) => parseSnapshot(value),
      (error: unknown) => ({ windows: [], fetchedAt: Date.now(), error: 'failed' as const, message: String(error).slice(0, 300) }),
    ),
    wake: (request) => plugin('agentQuota.wake', request).then(
      (value) => (isRecord(value) ? { ok: value.ok === true, message: typeof value.message === 'string' ? value.message : undefined } : { ok: false, message: 'No answer.' }),
      (error: unknown) => ({ ok: false, message: String(error).slice(0, 300) }),
    ),
  }
}
