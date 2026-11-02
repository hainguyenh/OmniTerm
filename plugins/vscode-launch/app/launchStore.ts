import { useEffect, useMemo, useSyncExternalStore } from 'react'

import type {
  DiscoveryResult,
  EditorKind,
  LaunchRunMode,
  LaunchRunSummary,
} from '../src/types'

import { diag } from '../../../ui/diag'
import type { VsCodeLaunchAPI } from './vscodeLaunchAPI'

export interface LaunchStoreState {
  available: boolean
  editors: EditorKind[]
  discoveries: Record<string, DiscoveryResult>
  selectedByRoot: Record<string, string[]>
  defaultMode: LaunchRunMode
  runs: LaunchRunSummary[]
  consoleOpen: boolean
  activeRunId: string | null
  consoleHeight: number
  lastError: string | null
}

const INITIAL_STATE: LaunchStoreState = {
  available: false,
  editors: [],
  discoveries: {},
  selectedByRoot: {},
  defaultMode: 'run',
  runs: [],
  consoleOpen: false,
  activeRunId: null,
  consoleHeight: 280,
  lastError: null,
}

let state: LaunchStoreState = INITIAL_STATE
let currentApi: VsCodeLaunchAPI | null = null
const listeners = new Set<() => void>()
const inFlightDiscoveries = new Map<string, Promise<DiscoveryResult>>()
const dismissedRunIds = new Set<string>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getLaunchState(): LaunchStoreState {
  return state
}

export function updateLaunchState(updater: (prev: LaunchStoreState) => LaunchStoreState): void {
  const next = updater(state)
  if (next === state) return
  state = next
  emit()
}

export function subscribeLaunchStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLaunchStore<T>(selector: (snapshot: LaunchStoreState) => T): T {
  return useSyncExternalStore(
    subscribeLaunchStore,
    () => selector(state),
    () => selector(INITIAL_STATE),
  )
}

export function registerLaunchApi(api: VsCodeLaunchAPI | null): void {
  currentApi = api
}

export function getRegisteredLaunchApi(): VsCodeLaunchAPI | null {
  return currentApi
}

export function resetLaunchStore(): void {
  state = INITIAL_STATE
  currentApi = null
  inFlightDiscoveries.clear()
  dismissedRunIds.clear()
  emit()
}

export function setLaunchAvailable(available: boolean, editors: EditorKind[] = []): void {
  updateLaunchState((prev) => {
    if (
      prev.available === available &&
      prev.editors.length === editors.length &&
      prev.editors.every((e, i) => e === editors[i])
    ) {
      return prev
    }
    return {
      ...prev,
      available,
      editors,
      ...(available ? {} : { consoleOpen: false, runs: [] }),
    }
  })
}

export function setDefaultLaunchMode(mode: LaunchRunMode): void {
  updateLaunchState((prev) => (prev.defaultMode === mode ? prev : { ...prev, defaultMode: mode }))
}

export function ensureDiscovered(rootDir: string, force = false): Promise<DiscoveryResult | null> {
  const trimmed = rootDir.trim()
  if (!trimmed || !currentApi || !state.available) return Promise.resolve(null)
  if (!force && state.discoveries[trimmed]) {
    return Promise.resolve(state.discoveries[trimmed])
  }
  const existing = inFlightDiscoveries.get(trimmed)
  if (existing && !force) return existing

  const req = currentApi
    .discover(trimmed)
    .then((result) => {
      updateLaunchState((prev) => ({
        ...prev,
        discoveries: { ...prev.discoveries, [trimmed]: result },
        editors: result.editors.length > 0 ? result.editors : prev.editors,
      }))
      return result
    })
    .finally(() => {
      inFlightDiscoveries.delete(trimmed)
    })

  inFlightDiscoveries.set(trimmed, req)
  return req
}

export function toggleSelectedConfig(rootDir: string, configId: string): void {
  updateLaunchState((prev) => {
    const current = prev.selectedByRoot[rootDir] ?? []
    const nextList = current.includes(configId)
      ? current.filter((id) => id !== configId)
      : [...current, configId]
    return {
      ...prev,
      selectedByRoot: { ...prev.selectedByRoot, [rootDir]: nextList },
    }
  })
}

export function setRunsSnapshot(runs: LaunchRunSummary[]): void {
  const filtered = runs.filter((r) => !dismissedRunIds.has(r.runId))
  updateLaunchState((prev) => {
    const newlyFailed = filtered.find(
      (r) =>
        r.status === 'failed' &&
        !dismissedRunIds.has(r.runId) &&
        !prev.runs.some((old) => old.runId === r.runId && old.status === 'failed'),
    )
    const activeStillPresent = prev.activeRunId && filtered.some((r) => r.runId === prev.activeRunId)
    return {
      ...prev,
      runs: filtered,
      activeRunId: newlyFailed
        ? newlyFailed.runId
        : activeStillPresent
          ? prev.activeRunId
          : (filtered[0]?.runId ?? null),
      consoleOpen: newlyFailed ? true : prev.consoleOpen,
    }
  })
}

function mergeStartedRuns(started: LaunchRunSummary[]): void {
  if (started.length === 0) return
  for (const item of started) {
    dismissedRunIds.delete(item.runId)
  }
  updateLaunchState((prev) => {
    const map = new Map(prev.runs.map((r) => [r.runId, r]))
    for (const item of started) map.set(item.runId, item)
    const merged = Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt)
    const immediateFailure = started.find((r) => r.status === 'failed')
    return {
      ...prev,
      runs: merged,
      activeRunId: (immediateFailure ?? started[0]).runId,
      consoleOpen: immediateFailure ? true : prev.consoleOpen,
      lastError: null,
    }
  })
}

export async function startConfigs(
  rootDir: string,
  configIds: readonly string[],
  mode: LaunchRunMode,
): Promise<LaunchRunSummary[]> {
  if (!currentApi || configIds.length === 0) return []
  try {
    const started = await currentApi.start({ rootDir, configIds, mode })
    mergeStartedRuns(started)
    return started
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    diag.error('[vscodeLaunch] startConfigs failed', err)
    updateLaunchState((prev) => ({ ...prev, lastError: msg }))
    return []
  }
}

export async function startCompound(
  rootDir: string,
  compoundId: string,
  mode: LaunchRunMode,
): Promise<LaunchRunSummary[]> {
  if (!currentApi) return []
  try {
    const started = await currentApi.start({ rootDir, compoundId, mode })
    mergeStartedRuns(started)
    return started
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    diag.error('[vscodeLaunch] startCompound failed', err)
    updateLaunchState((prev) => ({ ...prev, lastError: msg }))
    return []
  }
}

export async function stopRuns(runIds: readonly string[]): Promise<void> {
  if (!currentApi || runIds.length === 0) return
  await currentApi.stop(runIds)
  const fresh = await currentApi.listRuns()
  setRunsSnapshot(fresh)
}

export async function stopAllInRoot(rootDir: string): Promise<void> {
  if (!currentApi) return
  await currentApi.stopInRoot(rootDir)
  const fresh = await currentApi.listRuns()
  setRunsSnapshot(fresh)
}

export async function restartRun(runId: string, mode?: LaunchRunMode): Promise<void> {
  if (!currentApi) return
  const restarted = await currentApi.restart(runId, mode)
  const fresh = await currentApi.listRuns()
  setRunsSnapshot(fresh)
  if (restarted) {
    updateLaunchState((prev) => ({ ...prev, activeRunId: restarted.runId }))
  }
}

export function openConsoleForRun(runId?: string): void {
  updateLaunchState((prev) => ({
    ...prev,
    consoleOpen: true,
    activeRunId: runId ?? prev.activeRunId ?? prev.runs[0]?.runId ?? null,
  }))
}

export function selectConsoleRun(runId: string): void {
  updateLaunchState((prev) => ({ ...prev, activeRunId: runId }))
}

export function closeConsole(): void {
  updateLaunchState((prev) => (prev.consoleOpen ? { ...prev, consoleOpen: false } : prev))
}

export function removeRun(runId: string): void {
  dismissedRunIds.add(runId)
  updateLaunchState((prev) => {
    const nextRuns = prev.runs.filter((r) => r.runId !== runId)
    const nextActiveRunId =
      prev.activeRunId === runId
        ? nextRuns[0]?.runId ?? null
        : prev.activeRunId
    return {
      ...prev,
      runs: nextRuns,
      activeRunId: nextActiveRunId,
      consoleOpen: nextRuns.length === 0 ? false : prev.consoleOpen,
    }
  })
}

export async function closeTargetConsole(runId: string): Promise<void> {
  const run = getLaunchState().runs.find((r) => r.runId === runId)
  if (run && (run.status === 'starting' || run.status === 'running') && currentApi) {
    try {
      await currentApi.stop([runId])
    } catch {
      // ignore
    }
  }
  removeRun(runId)
  if (currentApi) {
    try {
      await currentApi.removeRun(runId)
    } catch {
      // ignore
    }
  }
}

export function setConsoleHeight(heightPx: number): void {
  const maxPx =
    typeof window !== 'undefined' && window.innerHeight > 240
      ? Math.max(240, Math.floor(window.innerHeight * 0.75))
      : 720
  const clamped = Math.max(180, Math.min(maxPx, Math.round(heightPx)))
  updateLaunchState((prev) => (prev.consoleHeight === clamped ? prev : { ...prev, consoleHeight: clamped }))
}

function normalizeRootKey(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function useHasLaunchConfigs(folderPath?: string): boolean {
  const trimmedPath = folderPath?.trim() || undefined
  const available = useLaunchStore((s) => s.available)
  const discovery = useLaunchStore((s) => (trimmedPath ? s.discoveries[trimmedPath] : undefined))
  const allRuns = useLaunchStore((s) => s.runs)

  useEffect(() => {
    if (!available || !trimmedPath) return
    void ensureDiscovered(trimmedPath)
  }, [available, trimmedPath])

  return useMemo(() => {
    if (!available || !trimmedPath || !discovery) return false
    const runnableCount = discovery.files.reduce(
      (sum, file) => sum + file.configurations.filter((cfg) => cfg.runnable).length,
      0,
    )
    if (runnableCount > 0 || discovery.compounds.length > 0) return true
    const norm = normalizeRootKey(trimmedPath)
    return allRuns.some((run) => {
      const rNorm = normalizeRootKey(run.rootDir)
      return rNorm === norm || norm.startsWith(`${rNorm}/`) || rNorm.startsWith(`${norm}/`)
    })
  }, [available, trimmedPath, discovery, allRuns])
}
