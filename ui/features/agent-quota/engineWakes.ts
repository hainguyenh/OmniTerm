import type { AgentQuotaAPI } from './agentQuotaAPI'

import { AGENT_LABELS, type AgentConfig } from './quotaConfig'
import { getQuotaState, patchProfile, pushNotice } from './quotaStore'
import { dueWake, weekSpent } from './wakePolicy'

/** A woken profile is read again this soon, to show its new session window. */
const AFTER_WAKE_REFRESH_MS = 5000

/** What the wake schedule needs from the quota engine (quotaEngine.ts). */
export interface WakeContext {
  api: AgentQuotaAPI
  now(): number
  /** Each open terminal's config for the profile: a shared profile may carry several overrides. */
  configsForProfile(profileKey: string): AgentConfig[]
  configForProfile(profileKey: string): AgentConfig | undefined
  isBusy(profileKey: string): boolean
  track<T>(work: Promise<T>): Promise<T>
}

/** Send each profile whose wake time has come its prompt; a busy one only marks the slot as used. */
export function scheduleWakes(context: WakeContext, now: number): void {
  for (const profile of Object.values(getQuotaState().profiles)) {
    if (profile.waking) continue
    const scheduled = context.configsForProfile(profile.key)
      .filter((config) => config.enabled)
      .map((config) => ({ config, key: dueWake(config, profile.wake, profile.lastGood, now) }))
      .find((entry): entry is { config: AgentConfig; key: string } => entry.key !== null)
    if (!scheduled) continue
    if (context.isBusy(profile.key)) {
      patchProfile(profile.key, (current) => ({
        wake: { ...current.wake, lastKey: scheduled.key },
      }))
      continue
    }
    void context.track(wakeProfile(context, profile.key, scheduled.key, scheduled.config))
  }
}

export async function wakeProfile(context: WakeContext, key: string, scheduleKey?: string, requestedConfig?: AgentConfig): Promise<void> {
  const profile = getQuotaState().profiles[key]
  if (!profile || profile.waking) return
  const config = requestedConfig ?? context.configForProfile(key) ?? getQuotaState().config.agents[profile.agent]
  const name = `${AGENT_LABELS[profile.agent]} (${profile.profileName})`
  if (weekSpent(profile.lastGood, config)) {
    pushNotice('warning', `Wake-up skipped for ${name}: its weekly limit is reached.`)
    return
  }
  patchProfile(key, (current) => ({ waking: true, wake: scheduleKey ? { ...current.wake, lastKey: scheduleKey } : current.wake }))
  const result = await context.api.wake({ agent: profile.agent, profileDir: profile.profileDir, launcher: profile.launcher, prompt: config.wake.prompt })
  const now = context.now()
  patchProfile(key, () => ({ waking: false, nextFetchAt: now + AFTER_WAKE_REFRESH_MS }))
  pushNotice(result.ok ? 'info' : 'danger', result.ok ? `Woke ${name}: a new session window has started.` : `Wake-up failed for ${name}: ${result.message ?? 'unknown error'}`)
}
