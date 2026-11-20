import type { QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { AgentConfig } from './quotaConfig'
import type { ProfileQuota } from './quotaStore'

import { runGuards } from './guardRunner'
import { intervalForProfile } from './profileInterval'
import { FRESH_MS, isOlderReading, windowOf } from './quotaPolicy'
import { getQuotaState, patchProfile } from './quotaStore'
import { pushSample } from './smartInterval'
import { rememberReset } from './wakePolicy'

/** What applying a reading needs from the quota engine (quotaEngine.ts). */
export interface ReadingContext {
  api: AgentQuotaAPI
  now(): number
  random(): number
  busy(): Readonly<Record<string, boolean>>
  /** Each open terminal's config for the profile: a shared profile may carry several overrides. */
  configsForProfile(profileKey: string): AgentConfig[]
}

function sameWindows(a: QuotaSnapshot, b: QuotaSnapshot): boolean {
  return a.windows.length === b.windows.length && a.windows.every((window, index) => {
    const other = b.windows[index]
    return window.kind === other.kind && window.usedPct === other.usedPct && window.resetsAt === other.resetsAt
  })
}

/**
 * Whether a status line bridge record is news for the profile: written after the last one applied,
 * or that same record read again after one of its windows rolled over (Rust then reports the window
 * as a new, unused one). The bridge record of any age is what a background read hands back too, so
 * without this every read would apply the same record again.
 */
export function isNewBridgeRecord(snapshot: QuotaSnapshot, profile: ProfileQuota): boolean {
  const at = profile.bridgeAt
  if (at === undefined || snapshot.fetchedAt > at) return true
  if (snapshot.fetchedAt < at) return false
  const held = profile.lastGood
  return held?.fetchedAt === at && !sameWindows(held, snapshot)
}

/**
 * Whether a reading replaces the one held. A live one — the agent just handed its status line
 * bridge a new record — always does. Any other (the `-p /usage` read, the inline probe) does not
 * while the bridge reported within `FRESH_MS`: the bridge is the agent's own reading, and a CLI run
 * that started before the agent reported must not roll the profile back to what the CLI saw.
 */
function replacesHeld(snapshot: QuotaSnapshot, profile: ProfileQuota, live: boolean, now: number): boolean {
  if (live) return true
  if (isOlderReading(snapshot, profile.lastGood)) return false
  if (snapshot.source === 'statusline' && !snapshot.error) return isNewBridgeRecord(snapshot, profile)
  return profile.bridgeAt === undefined || now - profile.bridgeAt > FRESH_MS
}

/**
 * Apply one reading — from the `-p` read, the inline probe or the status line bridge — then
 * schedule the next background read. A live bridge reading leaves a background read in flight
 * alone (`fetching`); it only pushes the next one back.
 */
export async function applyReading(context: ReadingContext, key: string, snapshot: QuotaSnapshot, live = false): Promise<void> {
  const profile = getQuotaState().profiles[key]
  if (!profile) return
  const now = context.now()
  const session = windowOf(snapshot, 'session')
  const global = getQuotaState().config.agents[profile.agent]
  const wakeDelays = context.configsForProfile(key).map((config) => config.wake.delayMinutes)
  const wakeDelay = wakeDelays.length > 0 ? Math.max(...wakeDelays) : global.wake.delayMinutes
  if (replacesHeld(snapshot, profile, live, now)) {
    patchProfile(key, (current) => ({
      snapshot,
      lastGood: snapshot.error ? current.lastGood : snapshot,
      history: !snapshot.error && session ? pushSample(current.history, { at: now, usedPct: session.usedPct }) : current.history,
      errorStreak: snapshot.error ? current.errorStreak + 1 : 0,
      wake: snapshot.error ? current.wake : rememberReset(current.wake, snapshot, wakeDelay, now),
      ...(live || (snapshot.source === 'statusline' && !snapshot.error) ? { bridgeAt: snapshot.fetchedAt } : {}),
    }))
    await runGuards(context.api, key, snapshot, now)
  }
  patchProfile(key, (current) => ({
    ...(live ? {} : { fetching: false }),
    nextFetchAt: now + intervalForProfile(current, context.busy(), context.random, now),
  }))
}
