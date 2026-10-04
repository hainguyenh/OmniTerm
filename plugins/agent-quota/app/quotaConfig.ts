import { isSafePrompt } from '../src/prompt'
import type { AgentKind, WindowKind } from '../src/types'

/**
 * Agent Quota settings: one global object under `settings.agentQuota`, validated here because the
 * settings file is user-editable and outlives versions. Per-terminal overrides are deliberately not
 * part of it — they live in memory, keyed to one agent process, and die with it.
 */

export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'codex', 'agy']
export const WINDOW_KINDS: readonly WindowKind[] = ['session', 'weekly', 'monthly']

export type WakeMode = 'off' | 'timeOfDay' | 'afterReset'
export type LineSize = 'thin' | 'normal' | 'thick'
export type ArtSpeed = 'slow' | 'normal' | 'fast'
export type ArtSize = 'compact' | 'normal' | 'large'

export interface WakeConfig {
  mode: WakeMode
  /** Local `HH:MM` for `timeOfDay`. */
  time: string
  /** Minutes after the session reset for `afterReset`. */
  delayMinutes: number
  prompt: string
}

export interface ResumeRecoveryConfig {
  enabled: boolean
  delaySeconds: number
  prompt: string
}

export interface AgentConfig {
  enabled: boolean
  /** Used-percent at which the window counts as exhausted, per window. */
  limits: Record<WindowKind, number>
  suspendAtLimit: boolean
  autoResume: boolean
  /** Minutes after a reset before an automatic resume, so the provider has really rolled over. */
  resumeDelayMinutes: number
  /** How long the post-suspend watchdog keeps polling fast. */
  guardMinutes: number
  /** Stop (not just freeze) the agent if usage still climbs past this while suspended. */
  hardStopAtPct: number | null
  wake: WakeConfig
  resumeRecovery: ResumeRecoveryConfig
}

export interface IconConfig {
  agent: boolean
  overrideBadge: boolean
  resetCountdown: boolean
  wakeButton: boolean
  suspendState: boolean
}

/** How fast the 5h window is being burned through, projected to the reset. */
export type PaceTier = 'slow' | 'onTrack' | 'fast' | 'overshooting'
export const PACE_TIERS: readonly PaceTier[] = ['slow', 'onTrack', 'fast', 'overshooting']

export interface PaceGlyph {
  kind: 'emoji'
  value: string
}

export interface PaceConfig {
  enabled: boolean
  glyphs: Record<PaceTier, PaceGlyph>
}

export interface DisplayConfig {
  size: LineSize
  lines: Record<WindowKind, boolean>
  icons: IconConfig
  animations: boolean
  /** Use the optional user-provided light/dark art for a busy terminal header session. */
  customArtSession: boolean
  /** Hide the weekly line while it is barely used and its reset is still a long way off. */
  weeklyAutoHide: boolean
  weeklyThresholdPct?: number
  pace: PaceConfig
  artSpeed?: ArtSpeed
  artSize?: ArtSize
}

export interface QuotaConfig {
  enabled: boolean
  /** Show the quick-settings icon in the activity bar. */
  pinned: boolean
  display: DisplayConfig
  agents: Record<AgentKind, AgentConfig>
}

/** What a single terminal may change for its own agent instance. */
export interface AgentOverride {
  /** Pause quota reads and guard actions for this exact agent process. */
  enabled?: boolean
  limits?: Partial<Record<WindowKind, number>>
  suspendAtLimit?: boolean
  autoResume?: boolean
  /** Optional per-terminal wake profile; absent means the global profile applies. */
  wake?: WakeConfig
  /** Show the weekly line in this terminal even while the global auto-hide would hide it. */
  showWeekly?: boolean
  /** Optional per-terminal resume recovery settings. */
  resumeRecovery?: Partial<ResumeRecoveryConfig>
}

const defaultAgent = (enabled: boolean, defaultRecovery = false): AgentConfig => ({
  enabled,
  limits: { session: 90, weekly: 95, monthly: 95 },
  suspendAtLimit: true,
  autoResume: true,
  resumeDelayMinutes: 2,
  guardMinutes: 10,
  hardStopAtPct: null,
  wake: { mode: 'off', time: '06:00', delayMinutes: 2, prompt: 'hi' },
  resumeRecovery: { enabled: defaultRecovery, delaySeconds: 3, prompt: 'continue' },
})

/** Turtle → rabbit → plane → superman, from calm to way over pace. Text glyphs: no bundled assets,
 *  themeable by the user later without a binary asset pipeline. */
export const DEFAULT_PACE_GLYPHS: Record<PaceTier, PaceGlyph> = {
  slow: { kind: 'emoji', value: '🐢' },
  onTrack: { kind: 'emoji', value: '🐇' },
  fast: { kind: 'emoji', value: '✈️' },
  overshooting: { kind: 'emoji', value: '🦸' },
}

export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  enabled: true,
  pinned: true,
  display: {
    size: 'normal',
    lines: { session: true, weekly: true, monthly: true },
    icons: { agent: true, overrideBadge: true, resetCountdown: true, wakeButton: true, suspendState: true },
    animations: true,
    customArtSession: false,
    weeklyAutoHide: true,
    weeklyThresholdPct: 60,
    pace: { enabled: true, glyphs: DEFAULT_PACE_GLYPHS },
    artSpeed: 'normal',
    artSize: 'normal',
  },
  agents: { claude: defaultAgent(true, true), codex: defaultAgent(true, false), agy: defaultAgent(true, false) },
}

export const MIN_LIMIT = 5
export const MAX_LIMIT = 100

export function clampLimit(value: number): number {
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(value)))
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function parseAgent(value: unknown, fallback: AgentConfig): AgentConfig {
  const source = record(value)
  const limits = record(source.limits)
  const wake = record(source.wake)
  const hardStop = source.hardStopAtPct
  const recovery = record(source.resumeRecovery)
  // A stored `icon` (the retired header-icon setting) is dropped here and on the next save.
  return {
    enabled: bool(source.enabled, fallback.enabled),
    limits: {
      session: num(limits.session, fallback.limits.session, MIN_LIMIT, MAX_LIMIT),
      weekly: num(limits.weekly, fallback.limits.weekly, MIN_LIMIT, MAX_LIMIT),
      monthly: num(limits.monthly, fallback.limits.monthly, MIN_LIMIT, MAX_LIMIT),
    },
    suspendAtLimit: bool(source.suspendAtLimit, fallback.suspendAtLimit),
    autoResume: bool(source.autoResume, fallback.autoResume),
    resumeDelayMinutes: num(source.resumeDelayMinutes, fallback.resumeDelayMinutes, 0, 120),
    guardMinutes: num(source.guardMinutes, fallback.guardMinutes, 1, 60),
    hardStopAtPct: typeof hardStop === 'number' && Number.isFinite(hardStop) ? num(hardStop, 100, MIN_LIMIT, MAX_LIMIT) : null,
    wake: {
      mode: oneOf(wake.mode, ['off', 'timeOfDay', 'afterReset'] as const, fallback.wake.mode),
      time: typeof wake.time === 'string' && TIME.test(wake.time) ? wake.time : fallback.wake.time,
      delayMinutes: num(wake.delayMinutes, fallback.wake.delayMinutes, 0, 120),
      prompt: typeof wake.prompt === 'string' && isSafePrompt(wake.prompt.trim()) ? wake.prompt.trim().slice(0, 120) : fallback.wake.prompt,
    },
    resumeRecovery: {
      enabled: bool(recovery.enabled, fallback.resumeRecovery.enabled),
      delaySeconds: num(recovery.delaySeconds, fallback.resumeRecovery.delaySeconds, 1, 30),
      prompt: typeof recovery.prompt === 'string' && isSafePrompt(recovery.prompt.trim()) ? recovery.prompt.trim().slice(0, 120) : fallback.resumeRecovery.prompt,
    },
  }
}

function parsePaceGlyph(value: unknown, fallback: PaceGlyph): PaceGlyph {
  const source = record(value)
  if (source.kind !== 'emoji') return fallback
  const glyphValue = source.value
  return typeof glyphValue === 'string' && glyphValue.length > 0 && glyphValue.length <= 8
    ? { kind: 'emoji', value: glyphValue }
    : fallback
}

function parsePace(value: unknown, fallback: PaceConfig): PaceConfig {
  const source = record(value)
  const glyphs = record(source.glyphs)
  return {
    enabled: bool(source.enabled, fallback.enabled),
    glyphs: Object.fromEntries(
      PACE_TIERS.map((tier) => [tier, parsePaceGlyph(glyphs[tier], fallback.glyphs[tier])]),
    ) as Record<PaceTier, PaceGlyph>,
  }
}

/** Read persisted settings, keeping every valid field and defaulting the rest. */
export function parseQuotaConfig(value: unknown): QuotaConfig {
  const source = record(value)
  const display = record(source.display)
  const lines = record(display.lines)
  const icons = record(display.icons)
  const agents = record(source.agents)
  const base = DEFAULT_QUOTA_CONFIG
  return {
    enabled: bool(source.enabled, base.enabled),
    pinned: bool(source.pinned, base.pinned),
    display: {
      size: oneOf(display.size, ['thin', 'normal', 'thick'] as const, base.display.size),
      lines: {
        session: bool(lines.session, base.display.lines.session),
        weekly: bool(lines.weekly, base.display.lines.weekly),
        monthly: bool(lines.monthly, base.display.lines.monthly),
      },
      icons: {
        agent: bool(icons.agent, base.display.icons.agent),
        overrideBadge: bool(icons.overrideBadge, base.display.icons.overrideBadge),
        resetCountdown: bool(icons.resetCountdown, base.display.icons.resetCountdown),
        wakeButton: bool(icons.wakeButton, base.display.icons.wakeButton),
        suspendState: bool(icons.suspendState, base.display.icons.suspendState),
      },
      animations: bool(display.animations, base.display.animations),
      customArtSession: bool(display.customArtSession, base.display.customArtSession),
      weeklyAutoHide: bool(display.weeklyAutoHide, base.display.weeklyAutoHide),
      weeklyThresholdPct: num(display.weeklyThresholdPct, base.display.weeklyThresholdPct ?? 60, 0, 100),
      pace: parsePace(display.pace, base.display.pace),
      artSpeed: oneOf(display.artSpeed, ['slow', 'normal', 'fast'] as const, base.display.artSpeed ?? 'normal'),
      artSize: oneOf(display.artSize, ['compact', 'normal', 'large'] as const, base.display.artSize ?? 'normal'),
    },
    agents: {
      claude: parseAgent(agents.claude, base.agents.claude),
      codex: parseAgent(agents.codex, base.agents.codex),
      agy: parseAgent(agents.agy, base.agents.agy),
    },
  }
}

/** Global settings with a terminal's override on top. An empty override changes nothing. */
export function effectiveConfig(global: AgentConfig, override: AgentOverride | undefined): AgentConfig {
  if (!override) return global
  return {
    ...global,
    enabled: override.enabled ?? global.enabled,
    limits: { ...global.limits, ...override.limits },
    suspendAtLimit: override.suspendAtLimit ?? global.suspendAtLimit,
    autoResume: override.autoResume ?? global.autoResume,
    wake: override.wake ? { ...global.wake, ...override.wake } : global.wake,
    resumeRecovery: override.resumeRecovery ? { ...global.resumeRecovery, ...override.resumeRecovery } : global.resumeRecovery,
  }
}

function sameWakeConfig(left: WakeConfig, right: WakeConfig): boolean {
  return left.mode === right.mode && left.time === right.time && left.delayMinutes === right.delayMinutes && left.prompt === right.prompt
}

function sameRecoveryConfig(left: ResumeRecoveryConfig, right: ResumeRecoveryConfig): boolean {
  return left.enabled === right.enabled && left.delaySeconds === right.delaySeconds && left.prompt === right.prompt
}

/** Apply the per-terminal wake switch without losing the rest of its effective profile. */
export function wakeConfigWithEnabled(global: AgentConfig, current: AgentConfig, enabled: boolean): WakeConfig {
  if (!enabled) return { ...current.wake, mode: 'off' }
  return {
    ...current.wake,
    mode: current.wake.mode === 'off' ? (global.wake.mode === 'off' ? 'afterReset' : global.wake.mode) : current.wake.mode,
  }
}

/** Drop override fields equal to the global value, so an override only exists while it differs. */
export function pruneOverride(global: AgentConfig, override: AgentOverride): AgentOverride | null {
  const limits = Object.fromEntries(
    Object.entries(override.limits ?? {}).filter(([kind, value]) => value !== global.limits[kind as WindowKind]),
  ) as Partial<Record<WindowKind, number>>
  const effectiveRecovery = override.resumeRecovery ? { ...global.resumeRecovery, ...override.resumeRecovery } : global.resumeRecovery
  const pruned: AgentOverride = {
    ...(override.enabled !== undefined && override.enabled !== global.enabled ? { enabled: override.enabled } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(override.suspendAtLimit !== undefined && override.suspendAtLimit !== global.suspendAtLimit ? { suspendAtLimit: override.suspendAtLimit } : {}),
    ...(override.autoResume !== undefined && override.autoResume !== global.autoResume ? { autoResume: override.autoResume } : {}),
    ...(override.wake && !sameWakeConfig(override.wake, global.wake) ? { wake: override.wake } : {}),
    ...(override.resumeRecovery && !sameRecoveryConfig(effectiveRecovery, global.resumeRecovery) ? { resumeRecovery: override.resumeRecovery } : {}),
    // Display-only: there is no global counterpart, so only `true` is a difference worth keeping.
    ...(override.showWeekly ? { showWeekly: true } : {}),
  }
  return Object.keys(pruned).length > 0 ? pruned : null
}

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  agy: 'Antigravity CLI',
}

export const WINDOW_LABELS: Record<WindowKind, { long: string; short: string }> = {
  session: { long: 'Session (5h)', short: '5h' },
  weekly: { long: 'Weekly', short: 'Week' },
  monthly: { long: 'Monthly', short: 'Mo' },
}
