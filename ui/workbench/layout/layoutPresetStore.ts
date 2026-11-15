import { diag } from '../../diag'
import { useTabs } from '../../ide/editor/core/controller'
import { paneIds, type TabsState } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'

import { applyPreset, detectPreset, isPresetId, restorePanes, snapshotPanes, type DetectedPreset, type MaximizeSnapshot, type PresetId } from './layoutPresets'

/**
 * The layout preset of the editor: applying it, remembering it per project and bringing it back
 * after a project's tabs were restored. The preset itself is never stored in the editor session
 * (that holds the layout tree); this is a separate, per-project preference.
 */

const STORAGE_KEY = 'omniterm.layoutPreset.v1'

/** FNV-1a of the project root: the folder path itself is not kept in storage. */
export function projectKey(root: string | null): string {
  if (root === null) return 'none'
  let hash = 0x811c9dc5
  for (let i = 0; i < root.length; i++) {
    hash ^= root.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function currentProjectKey(): string {
  const { project, lightEdit } = useProject.getState()
  return projectKey(project?.root ?? (lightEdit ? 'lightedit' : null))
}

/** Persisted presets are untrusted: only known preset ids under short keys survive. */
export function parseStoredPresets(raw: unknown): Record<string, PresetId> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, PresetId> = {}
  for (const [key, value] of Object.entries(raw)) if (key.length <= 16 && isPresetId(value)) out[key] = value
  return out
}

function loadStored(): Record<string, PresetId> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return raw ? parseStoredPresets(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function storedPreset(key = currentProjectKey()): PresetId | null {
  return loadStored()[key] ?? null
}

function remember(preset: PresetId, key = currentProjectKey()): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadStored(), [key]: preset }))
  } catch {
    // Storage may be blocked: the preset then lasts for this run only.
  }
}

/** The preset the editor has now. */
export function currentPreset(state: TabsState = useTabs.getState()): DetectedPreset {
  return detectPreset(state.layout)
}

let maximized: { snapshot: MaximizeSnapshot; key: string } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Whether a pane is maximized (a temporary single-pane layout). */
export function isMaximized(): boolean {
  return maximized !== null
}

export function subscribeMaximized(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function commit(next: TabsState): void {
  if (next !== useTabs.getState()) useTabs.setState(next, true)
}

/** Switches the editor to `preset`. Does nothing, and says so, while a project is being opened. */
export function applyEditorPreset(preset: PresetId): boolean {
  if (useProject.getState().opening) return false
  // Choosing a layout ends a maximize without restoring the old one.
  if (maximized) {
    maximized = null
    notify()
  }
  commit(applyPreset(useTabs.getState(), preset))
  remember(preset)
  return true
}

/** Maximizes the active pane: a temporary single pane that remembers where every tab was. */
export function maximizeActivePane(): boolean {
  if (maximized || useProject.getState().opening) return false
  const state = useTabs.getState()
  if (paneIds(state).length < 2) return false
  maximized = { snapshot: snapshotPanes(state, currentPreset(state)), key: currentProjectKey() }
  commit(applyPreset(state, '1'))
  notify()
  return true
}

/** Puts the layout back as it was before the maximize (Escape / the restore button). */
export function restoreMaximized(): boolean {
  if (!maximized || useProject.getState().opening) return false
  const { snapshot, key } = maximized
  maximized = null
  // A project switched meanwhile has its own tabs: the old pane indices mean nothing there.
  if (key === currentProjectKey()) commit(restorePanes(useTabs.getState(), snapshot))
  notify()
  return true
}

/**
 * Brings back the project's preset after its tabs were restored, when the restored layout is a
 * preset other than the remembered one (a layout the user split by hand is left alone). Waits for
 * the first tab of a freshly opened project so that it applies to the restored session, not to
 * the empty editor that precedes it.
 */
export function startPresetRestorer(): () => void {
  let waitingFor: string | null = currentProjectKey()
  const attempt = () => {
    const { opening } = useProject.getState()
    if (waitingFor === null || opening) return
    const state = useTabs.getState()
    if (!Object.values(state.panes).some((pane) => pane.tabs.length > 0)) return
    const wanted = storedPreset(waitingFor)
    waitingFor = null
    const now = currentPreset(state)
    if (wanted && now !== 'custom' && now !== wanted) {
      try {
        commit(applyPreset(state, wanted))
      } catch (error) {
        diag.warn('[layout] could not bring back the layout preset', error)
      }
    }
  }
  let root = useProject.getState().project?.root ?? null
  const stops = [
    useProject.subscribe((state) => {
      const next = state.project?.root ?? null
      if (next !== root) {
        root = next
        waitingFor = currentProjectKey()
        if (maximized) {
          maximized = null
          notify()
        }
      }
      attempt()
    }),
    useTabs.subscribe(attempt),
  ]
  attempt()
  return () => stops.forEach((stop) => stop())
}
