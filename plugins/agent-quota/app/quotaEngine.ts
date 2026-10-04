import type { AgentKind, QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'
import type { ProfileQuota, TerminalAgent } from './quotaStore'

import { releaseUnguarded, resumeByHand, runGuards, suspendByHand } from './guardRunner'
import { cancelUsageRead, pollUsageReads, readUsageNow, type ManualReadDeps } from './manualUsageRead'
import { intervalForProfile } from './profileInterval'
import { instanceKeyOf, profileKeyOf } from './profileKey'
import { AGENT_LABELS, type AgentConfig } from './quotaConfig'
import { isHeld } from './quotaGuard'
import { isOlderReading, windowOf } from './quotaPolicy'
import { getQuotaState, patchProfile, pushNotice, terminalConfig, updateQuota } from './quotaStore'
import { pushSample } from './smartInterval'
import { dueWake, rememberReset, weekSpent } from './wakePolicy'

/**
 * The Agent Quota loop. Once a second it advances the shared clock; every few seconds it asks Rust
 * which agent each open terminal runs; and it reads each *active* profile's quota on that profile's
 * own smart interval, then lets the guard and the wake schedule act on the reading.
 *
 * Plain class with injected API, clock and timers, so every rule is testable without React.
 */

export interface EngineDeps {
  api: AgentQuotaAPI
  now(): number
  random(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /**
   * Read quota from the agent itself when it starts in a terminal (see inlineUsageProbe.ts); null
   * when it can't, and the background read runs instead. Absent: always the background read.
   */
  inlineProbe?(terminal: TerminalAgent): Promise<QuotaSnapshot | null>
  /**
   * Freezes a pane from the moment an agent is started in it until the inline probe takes it over
   * (see `noteLaunch`); `release` lets go of a hold no probe is going to take.
   */
  launchHold?: { hold(sessionId: string): void; release(sessionId: string): void }
  /** A pane's rendered screen, for the strip's manual read (see manualUsageRead.ts). */
  readScreen?(sessionId: string): string[] | null
}

export interface EngineInputs {
  /** Terminal sessions open in this window; detection results for anything else are ignored. */
  sessionIds: readonly string[]
  busy: Readonly<Record<string, boolean>>
}

const TICK_MS = 1000
const DETECT_MS = 5000
const AFTER_WAKE_REFRESH_MS = 5000
/** While an agent is being started in a frozen pane, its process is looked for this often. */
const LAUNCH_DETECT_MS = 1000
/** A launch hold whose agent never shows up is released after this long… */
const LAUNCH_WAIT_MS = 20_000
/** …or once the shell has gone idle again this long after the launch (it printed and exited). */
const LAUNCH_IDLE_MS = 6_000
/** How long a new profile's background read waits for an inline probe before running anyway. */
const INLINE_PROBE_HOLD_MS = 8_000

export class QuotaEngine {
  private inputs: EngineInputs = { sessionIds: [], busy: {} }
  private timer: unknown = null
  private stopped = true
  private detectAt = 0
  private detecting = false
  /** Agent instances already offered to the inline probe: each launch or resume is asked once. */
  private readonly probed = new Set<string>()
  private readonly pending = new Set<Promise<unknown>>()
  /** Panes held since an agent was started in them, until detection finds it: session → when. */
  private readonly launching = new Map<string, number>()

  constructor(private readonly deps: EngineDeps) {}

  setInputs(inputs: EngineInputs): void {
    this.inputs = inputs
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const loop = () => {
      if (this.stopped) return
      void this.tick().finally(() => {
        if (!this.stopped) this.timer = this.deps.setTimer(loop, TICK_MS)
      })
    }
    loop()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    for (const sessionId of this.launching.keys()) this.releaseLaunch(sessionId)
  }

  /**
   * An agent is being started in this pane (an agent command was submitted, or a restored pane
   * starts with one): freeze it now and look for the process right away, instead of letting the
   * user type into its first screen until the next scan. A shell already running something took
   * the Enter itself, so it is left alone.
   */
  noteLaunch(sessionId: string, agent: AgentKind): void {
    const { config } = getQuotaState()
    if (!this.deps.launchHold || !this.deps.inlineProbe || this.launching.has(sessionId)) return
    if (!config.enabled || !config.agents[agent]?.enabled || this.inputs.busy[sessionId]) return
    this.deps.launchHold.hold(sessionId)
    this.launching.set(sessionId, this.deps.now())
    this.detectAt = 0
  }

  private releaseLaunch(sessionId: string): void {
    if (!this.launching.delete(sessionId)) return
    this.deps.launchHold?.release(sessionId)
  }

  private expireLaunches(now: number): void {
    for (const [sessionId, at] of this.launching) {
      const idle = now - at >= LAUNCH_IDLE_MS && this.inputs.busy[sessionId] === false
      if (now - at >= LAUNCH_WAIT_MS || idle) this.releaseLaunch(sessionId)
    }
  }

  /** Wait for every fetch, wake and guard action started so far (tests and shutdown). */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => {})
    return work
  }

  async tick(): Promise<void> {
    const now = this.deps.now()
    updateQuota((current) => ({ ...current, now }))
    await this.track(releaseUnguarded(this.deps.api))
    this.expireLaunches(now)
    if (!getQuotaState().config.enabled) return
    if (now >= this.detectAt && !this.detecting) await this.detect(now)
    for (const profile of Object.values(getQuotaState().profiles)) {
      const monitoring = this.configsForProfile(profile.key).some((config) => config.enabled)
      if (monitoring && !profile.fetching && now >= profile.nextFetchAt) void this.track(this.fetchProfile(profile.key))
    }
    this.scheduleWakes(now)
    pollUsageReads(this.manualRead)
  }

  private readonly manualRead: ManualReadDeps = {
    readScreen: (sessionId) => this.deps.readScreen?.(sessionId) ?? null,
    now: () => this.deps.now(),
    record: (key, snapshot) => {
      patchProfile(key, () => ({ fetching: true }))
      void this.track(this.record(key, snapshot))
    },
  }

  /** The strip's read button: the usage panel on this pane's screen, now or once the user opens it. */
  readUsage(sessionId: string): void {
    readUsageNow(this.manualRead, sessionId)
  }

  cancelUsageRead(sessionId: string): void {
    cancelUsageRead(sessionId)
  }

  /** A reading taken outside the engine (the Profiles dialog); a profile with no open pane is left alone. */
  recordReading(profileKey: string, snapshot: QuotaSnapshot): void {
    if (getQuotaState().profiles[profileKey]) this.manualRead.record(profileKey, snapshot)
  }

  private async detect(now: number): Promise<void> {
    this.detecting = true
    try {
      const rows = await this.deps.api.detect().catch(() => null)
      if (rows) this.applyDetection(rows, now)
    } finally {
      this.detecting = false
      this.detectAt = now + (this.launching.size > 0 ? LAUNCH_DETECT_MS : DETECT_MS)
    }
  }

  /**
   * Replace the terminal map. An instance that disappeared — the agent exited, or another one
   * started in its terminal — takes its override and guard with it, so the terminal falls back to
   * the global settings; if it was still held, its processes are thawed.
   */
  private applyDetection(rows: SessionAgent[], now: number): void {
    const open = new Set(this.inputs.sessionIds)
    const current = getQuotaState()
    const terminals: Record<string, TerminalAgent> = {}
    for (const row of rows) {
      if (!open.has(row.sessionId)) continue
      terminals[row.sessionId] = { ...row, instanceKey: instanceKeyOf(row), profileKey: profileKeyOf(row) }
    }
    const live = new Set(Object.values(terminals).map((terminal) => terminal.instanceKey))
    // Every agent process that appeared since the last detection — a launch or a resume — may be
    // asked inline. Its reading is the freshest there is, even for a profile already monitored.
    const started = Object.values(terminals).filter((terminal) => !this.probed.has(terminal.instanceKey))
    for (const key of this.probed) {
      if (!live.has(key)) this.probed.delete(key)
    }
    // A held pane whose agent showed up is the probe's to release; one where an agent was already
    // running took the Enter itself, so it is let go now.
    for (const sessionId of [...this.launching.keys()]) {
      const terminal = terminals[sessionId]
      if (!terminal) continue
      if (started.includes(terminal)) this.launching.delete(sessionId)
      else this.releaseLaunch(sessionId)
    }
    for (const old of Object.values(current.terminals)) {
      if (!live.has(old.instanceKey) && isHeld(current.guards[old.instanceKey])) void this.track(this.deps.api.resume(old.sessionId))
    }
    updateQuota((state) => {
      const keep = <T>(map: Record<string, T>) => Object.fromEntries(Object.entries(map).filter(([key]) => live.has(key)))
      const profiles: Record<string, ProfileQuota> = {}
      for (const terminal of Object.values(terminals)) {
        const profile = profiles[terminal.profileKey] ?? state.profiles[terminal.profileKey] ?? {
          key: terminal.profileKey,
          agent: terminal.agent,
          profileName: terminal.profileName,
          profileDir: terminal.profileDir,
          launcher: terminal.launcher,
          history: [],
          errorStreak: 0,
          nextFetchAt: now,
          fetching: false,
          wake: {},
          waking: false,
        }
        // Terminals sharing a profile directory share its row; the launcher, when any of them ran
        // one, names the profile and runs its reads.
        profiles[terminal.profileKey] = profile.launcher || !terminal.launcher
          ? profile
          : { ...profile, launcher: terminal.launcher, profileName: terminal.launcher }
      }
      return {
        ...state,
        terminals,
        profiles,
        overrides: keep(state.overrides),
        guards: keep(state.guards),
        editing: state.editing && terminals[state.editing] ? state.editing : null,
      }
    })
    if (!this.deps.inlineProbe) return
    const state = getQuotaState()
    for (const terminal of started) {
      this.probed.add(terminal.instanceKey)
      if (!terminalConfig(state, terminal).enabled) {
        this.deps.launchHold?.release(terminal.sessionId)
        continue
      }
      // A new profile has no reading yet: its background read waits for the probe.
      const previousNextFetchAt = current.profiles[terminal.profileKey]?.nextFetchAt
      patchProfile(terminal.profileKey, () => ({ nextFetchAt: now + INLINE_PROBE_HOLD_MS }))
      void this.track(this.probeInline(terminal.profileKey, terminal, previousNextFetchAt))
    }
  }

  private async probeInline(key: string, terminal: TerminalAgent, previousNextFetchAt?: number): Promise<void> {
    const snapshot = await this.deps.inlineProbe?.(terminal).catch(() => null)
    if (!snapshot || snapshot.error || snapshot.windows.length === 0) {
      patchProfile(key, () => ({ nextFetchAt: previousNextFetchAt ?? 0 }))
      const current = getQuotaState().profiles[key]
      if (current?.snapshot) await runGuards(this.deps.api, key, current.snapshot, this.deps.now())
      return
    }
    patchProfile(key, () => ({ fetching: true }))
    await this.record(key, snapshot)
  }

  private terminalsOf(profileKey: string): TerminalAgent[] {
    return Object.values(getQuotaState().terminals).filter((terminal) => terminal.profileKey === profileKey)
  }

  /** A shared profile may be open in more than one terminal, each with its own wake override. */
  private configsForProfile(profileKey: string): AgentConfig[] {
    const state = getQuotaState()
    return this.terminalsOf(profileKey).map((terminal) => terminalConfig(state, terminal))
  }

  private configForProfile(profileKey: string): AgentConfig | undefined {
    const terminals = this.terminalsOf(profileKey)
    const state = getQuotaState()
    const monitoring = terminals.find((terminal) => terminalConfig(state, terminal).enabled)
    const terminal = monitoring ?? terminals[0]
    return terminal ? terminalConfig(state, terminal) : undefined
  }

  private async fetchProfile(key: string): Promise<void> {
    const profile = getQuotaState().profiles[key]
    if (!profile || !this.configsForProfile(key).some((config) => config.enabled)) return
    patchProfile(key, () => ({ fetching: true }))
    const snapshot = await this.deps.api.fetchUsage({ agent: profile.agent, profileDir: profile.profileDir, launcher: profile.launcher })
    await this.record(key, snapshot)
  }

  /** Apply one reading — from the `-p` read or the inline probe — then schedule the next read. */
  private async record(key: string, snapshot: QuotaSnapshot): Promise<void> {
    const profile = getQuotaState().profiles[key]
    if (!profile) return
    const now = this.deps.now()
    const session = windowOf(snapshot, 'session')
    const global = getQuotaState().config.agents[profile.agent]
    const wakeDelays = this.configsForProfile(key).map((config) => config.wake.delayMinutes)
    const wakeDelay = wakeDelays.length > 0 ? Math.max(...wakeDelays) : global.wake.delayMinutes
    if (!isOlderReading(snapshot, profile.lastGood)) {
      patchProfile(key, (current) => ({
        snapshot,
        lastGood: snapshot.error ? current.lastGood : snapshot,
        history: !snapshot.error && session ? pushSample(current.history, { at: now, usedPct: session.usedPct }) : current.history,
        errorStreak: snapshot.error ? current.errorStreak + 1 : 0,
        wake: snapshot.error ? current.wake : rememberReset(current.wake, snapshot, wakeDelay, now),
      }))
      await runGuards(this.deps.api, key, snapshot, now)
    }
    patchProfile(key, (current) => ({ fetching: false, nextFetchAt: now + intervalForProfile(current, this.inputs.busy, this.deps.random, now) }))
  }

  private scheduleWakes(now: number): void {
    for (const profile of Object.values(getQuotaState().profiles)) {
      if (profile.waking) continue
      const isBusy = this.terminalsOf(profile.key).some((terminal) => this.inputs.busy[terminal.sessionId])
      const scheduled = this.configsForProfile(profile.key)
        .filter((config) => config.enabled)
        .map((config) => ({ config, key: dueWake(config, profile.wake, profile.lastGood, now) }))
        .find((entry): entry is { config: AgentConfig; key: string } => entry.key !== null)
      if (scheduled) {
        if (isBusy) {
          patchProfile(profile.key, (current) => ({
            wake: { ...current.wake, lastKey: scheduled.key },
          }))
          continue
        }
        void this.track(this.wakeProfile(profile.key, scheduled.key, scheduled.config))
      }
    }
  }

  private async wakeProfile(key: string, scheduleKey?: string, requestedConfig?: AgentConfig): Promise<void> {
    const profile = getQuotaState().profiles[key]
    if (!profile || profile.waking) return
    const config = requestedConfig ?? this.configForProfile(key) ?? getQuotaState().config.agents[profile.agent]
    const name = `${AGENT_LABELS[profile.agent]} (${profile.profileName})`
    if (weekSpent(profile.lastGood, config)) {
      pushNotice('warning', `Wake-up skipped for ${name}: its weekly limit is reached.`)
      return
    }
    patchProfile(key, (current) => ({ waking: true, wake: scheduleKey ? { ...current.wake, lastKey: scheduleKey } : current.wake }))
    const result = await this.deps.api.wake({ agent: profile.agent, profileDir: profile.profileDir, launcher: profile.launcher, prompt: config.wake.prompt })
    const now = this.deps.now()
    patchProfile(key, () => ({ waking: false, nextFetchAt: now + AFTER_WAKE_REFRESH_MS }))
    pushNotice(result.ok ? 'info' : 'danger', result.ok ? `Woke ${name}: a new session window has started.` : `Wake-up failed for ${name}: ${result.message ?? 'unknown error'}`)
  }

  /** Manual wake for one terminal's profile, or every active profile. */
  wake(target: { sessionId: string } | 'all'): void {
    const state = getQuotaState()
    const targets = target === 'all'
      ? Object.values(state.profiles)
        .map((profile) => ({ key: profile.key, config: this.configForProfile(profile.key) }))
        .filter((target): target is { key: string; config: AgentConfig } => target.config?.enabled === true)
      : (() => {
        const terminal = state.terminals[target.sessionId]
        const config = terminal ? terminalConfig(state, terminal) : undefined
        return terminal && config?.enabled ? [{ key: terminal.profileKey, config }] : []
      })()
    for (const { key, config } of targets) void this.track(this.wakeProfile(key, undefined, config))
  }

  refresh(profileKey?: string): void {
    for (const profile of Object.values(getQuotaState().profiles)) {
      if (!profileKey || profile.key === profileKey) patchProfile(profile.key, () => ({ nextFetchAt: 0 }))
    }
  }

  suspend(sessionId: string): void {
    void this.track(suspendByHand(this.deps.api, sessionId))
  }

  resume(sessionId: string): void {
    void this.track(resumeByHand(this.deps.api, sessionId, this.deps.now()))
  }

  resumeAll(): void {
    const state = getQuotaState()
    for (const terminal of Object.values(state.terminals)) {
      if (isHeld(state.guards[terminal.instanceKey])) this.resume(terminal.sessionId)
    }
  }
}
