import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { scanPaneAgents } from '../../utils/paneAgentScan'

import type { AgentKind, DiscoveredProfile, FetchUsageRequest, QuotaSnapshot, QuotaWindow, WakeRequest, WakeResult } from './usage/types'
import type { ProfileCensus } from './profileCensus'

import { parseProfileCensus } from './profileCensus'

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
  threads?: number[]
  profileName?: string
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

/** Validate a quota snapshot. Anything unreadable becomes an error snapshot the guard ignores. */
export function parseSnapshot(value: unknown, now: number = Date.now()): QuotaSnapshot {
  if (!isRecord(value)) return { windows: [], fetchedAt: now, error: 'failed', message: 'Agent Quota did not answer.' }
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

export function parseFrozenProcess(entry: unknown): FrozenProcess | null {
  if (!isRecord(entry) || !isInt(entry.pid) || !isInt(entry.startTime) || typeof entry.image !== 'string') return null
  const threads = Array.isArray(entry.threads) ? entry.threads.filter(isInt) : undefined
  const profileName = typeof entry.profileName === 'string' ? entry.profileName : undefined
  return {
    pid: entry.pid,
    startTime: entry.startTime,
    image: entry.image,
    ...(threads ? { threads } : {}),
    ...(profileName ? { profileName } : {}),
  }
}

export function parseFrozenList(value: unknown): FrozenProcess[] {
  if (!Array.isArray(value)) return []
  return value.map(parseFrozenProcess).filter((p): p is FrozenProcess => p !== null)
}

function parseReport(value: unknown): SuspendReport {
  const record = isRecord(value) ? value : {}
  const frozen = parseFrozenList(record.frozen)
  const errors = Array.isArray(record.errors) ? record.errors.filter((error): error is string => typeof error === 'string') : []
  return { frozen, newlyFrozen: isInt(record.newlyFrozen) ? record.newlyFrozen : 0, errors }
}

const count = (value: unknown) => (isInt(value) ? value : 0)

/**
 * Validate `agent_quota_list_profiles`: a launcher must be a bare name for its own agent, the name a
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

/** Every profile the user can start (the Profiles dashboard); a failing or switched-off feature lists none. */
export function listAgentProfiles(): Promise<DiscoveredProfile[]> {
  return invoke<unknown>('agent_quota_list_profiles').then(parseDiscoveredProfiles, () => [])
}

export interface AgentQuotaAPI {
  info(): Promise<boolean>
  /** `fresh`: walk the process table now instead of reusing a reading a few seconds old. */
  detect(fresh?: boolean): Promise<SessionAgent[]>
  /** A plugin or built-in feature was switched: whether Agent Quota is on may have changed. */
  onPluginsChanged?(listener: () => void): () => void
  suspend(sessionId: string, pid: number, startTime: number): Promise<SuspendReport>
  resume(sessionId: string): Promise<number>
  resumeAll(): Promise<number>
  resumePid?(sessionId: string, pid: number): Promise<boolean>
  getHeld?(sessionId?: string): Promise<FrozenProcess[]>
  terminate(sessionId: string, pid: number, startTime: number): Promise<number>
  fetchUsage(request: FetchUsageRequest): Promise<QuotaSnapshot>
  /**
   * Only the profile's status line bridge record, at any age: a small file read, never a CLI run
   * (see bridgeFollower.ts). Null without one, and on any failure.
   */
  readBridge?(request: FetchUsageRequest): Promise<QuotaSnapshot | null>
  /** The Claude sessions per profile on this whole machine (see profileCensus.ts). */
  census?(): Promise<ProfileCensus[]>
  wake(request: WakeRequest): Promise<WakeResult>
  listProfiles?(): Promise<DiscoveredProfile[]>
  /**
   * Whether the profile reports its quota by itself, installing its status line bridge when it
   * can (see passiveSources.ts); any failure is a "no".
   */
  ensurePassive?(request: FetchUsageRequest): Promise<boolean>
  /** The app's scratch folder for the hidden profile probe; null when it cannot say. */
  probeDir?(): Promise<string | null>
}

/** Broadcast by Rust when a plugin or built-in feature is switched or removed (plugin_commands.rs). */
const PLUGINS_CHANGED_EVENT = 'omniterm://plugins-changed'

export function createAgentQuotaAPI(): AgentQuotaAPI {
  return {
    /** Whether the built-in feature is switched on in the Plugins dialog. */
    info: () => invoke<unknown>('agent_quota_info').then((enabled) => enabled === true, () => false),
    detect: (fresh) => scanPaneAgents(fresh ? 0 : undefined).then(parseSessionAgents),
    onPluginsChanged: (listener) => {
      let unlisten: (() => void) | null = null
      let cancelled = false
      void listen(PLUGINS_CHANGED_EVENT, () => listener())
        .then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        .catch(() => {})
      return () => {
        cancelled = true
        unlisten?.()
      }
    },
    suspend: (sessionId, pid, startTime) => invoke<unknown>('agent_quota_suspend', { sessionId, pid, startTime }).then(parseReport),
    resume: (sessionId) => invoke<unknown>('agent_quota_resume', { sessionId }).then(count),
    resumeAll: () => invoke<unknown>('agent_quota_resume_all').then(count),
    resumePid: (sessionId, pid) => invoke<unknown>('agent_quota_resume_pid', { sessionId, pid }).then((res) => res === true, () => false),
    getHeld: (sessionId) => invoke<unknown>('agent_quota_get_held', { sessionId: sessionId ?? null }).then(parseFrozenList, () => []),
    terminate: (sessionId, pid, startTime) => invoke<unknown>('agent_quota_terminate', { sessionId, pid, startTime }).then(count),
    fetchUsage: (request) => invoke<unknown>('agent_quota_fetch_usage', { request }).then(
      (value) => parseSnapshot(value),
      (error: unknown) => ({ windows: [], fetchedAt: Date.now(), error: 'failed' as const, message: String(error).slice(0, 300) }),
    ),
    readBridge: (request) => invoke<unknown>('agent_quota_bridge_reading', { request }).then(
      (value) => (isRecord(value) ? parseSnapshot(value) : null),
      () => null,
    ),
    census: () => invoke<unknown>('agent_quota_profile_census').then(parseProfileCensus),
    wake: (request) => invoke<unknown>('agent_quota_wake', { request }).then(
      (value) => (isRecord(value) ? { ok: value.ok === true, message: typeof value.message === 'string' ? value.message : undefined } : { ok: false, message: 'No answer.' }),
      (error: unknown) => ({ ok: false, message: String(error).slice(0, 300) }),
    ),
    listProfiles: () => listAgentProfiles(),
    ensurePassive: (request) => invoke<unknown>('agent_quota_ensure_passive', { request }).then((value) => value === true, () => false),
    probeDir: () => invoke<unknown>('agent_quota_probe_dir').then(
      (value) => (typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\0') ? value : null),
      () => null,
    ),
  }
}
