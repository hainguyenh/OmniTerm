/**
 * Which AI agent runs in each open pane right now, as last reported by the process-tree poll in
 * `useSessionPersistence`. This is the one source of truth for "is this an agent pane" — the
 * header, the bookmark button and renew all read it, instead of each running its own one-shot
 * detection (which missed every agent started after the pane mounted).
 *
 * It also remembers panes freshly recreated by startup restore: their `claude --resume` has not
 * spawned yet when the first poll runs, and that empty first answer must not end their tracking.
 */
import { useSyncExternalStore } from 'react'
import type { DetectedPaneAgent } from './agentSessionDetector'

export interface PanePresence {
  agent: DetectedPaneAgent['agent']
  profileName: string
  launcher?: string
  pid: number
  startTime: number
  /** The resolved Claude session id, once its session file exists. */
  claudeSessionId?: string
  /** The resolved session id for any agent, once known. */
  agentSessionId?: string
}

/** How long a restored pane is given for its resumed agent to appear before it is untracked. */
export const RESTORE_GRACE_MS = 60_000

let presence: Record<string, PanePresence> = {}
const restoredAt = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function samePresence(a: PanePresence | undefined, b: PanePresence | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.agent === b.agent && a.profileName === b.profileName && a.launcher === b.launcher
    && a.pid === b.pid && a.startTime === b.startTime && a.claudeSessionId === b.claudeSessionId
    && a.agentSessionId === b.agentSessionId
}

/** Replace every pane's presence in one step; unchanged panes keep their object identity. */
export function setPanePresence(next: Record<string, PanePresence>): void {
  const ids = new Set([...Object.keys(presence), ...Object.keys(next)])
  let changed = false
  const merged: Record<string, PanePresence> = {}
  for (const id of ids) {
    const before = presence[id]
    const after = next[id]
    if (!samePresence(before, after)) changed = true
    if (after) merged[id] = samePresence(before, after) && before ? before : after
    if (after) restoredAt.delete(id)
  }
  if (!changed) return
  presence = merged
  emit()
}

export function getPanePresence(tabId: string | null | undefined): PanePresence | undefined {
  return tabId ? presence[tabId] : undefined
}

export function markRestoredPane(tabId: string, now = Date.now()): void {
  restoredAt.set(tabId, now)
}

/** True while a restored pane's resumed agent may still be starting. */
export function isInRestoreGrace(tabId: string, now = Date.now()): boolean {
  const at = restoredAt.get(tabId)
  if (at === undefined) return false
  if (now - at <= RESTORE_GRACE_MS) return true
  restoredAt.delete(tabId)
  return false
}

export function resetPanePresenceForTests(): void {
  presence = {}
  restoredAt.clear()
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePanePresence(tabId: string | null | undefined): PanePresence | undefined {
  return useSyncExternalStore(subscribe, () => getPanePresence(tabId), () => undefined)
}

/** Every pane's presence at once — for lists (the tab strip) that cannot call a hook per item. */
export function useAllPanePresence(): Readonly<Record<string, PanePresence>> {
  return useSyncExternalStore(subscribe, () => presence, () => presence)
}
