import {
  activateTab,
  moveTab,
  paneIds,
  splitAtEdge,
  type LayoutNode,
  type Tab,
  type TabsState,
} from '../../ide/editor/core/model/tabs'

/** A preset is a fixed arrangement of editor panes; every tab lives in one of them. */
export type PresetId = '1' | '2' | '2h' | '1+2' | '2x2' | '3x2' | '4x2'

export type DetectedPreset = PresetId | 'custom'

type Template = 'p' | { dir: 'row' | 'column'; children: Template[] }

const row = (count: number): Template => ({ dir: 'row', children: Array.from({ length: count }, () => 'p' as const) })

export interface PresetDef {
  id: PresetId
  label: string
  panes: number
  template: Template
  /** The numbered layout shortcut (Ctrl+N) that picks this preset, if any. */
  shortcut?: string
}

/** In the order the layout picker shows them; 2 rows has no shortcut. */
export const PRESETS: readonly PresetDef[] = [
  { id: '1', label: '1 pane', panes: 1, template: 'p', shortcut: 'Ctrl+1' },
  { id: '2', label: '2 columns', panes: 2, template: row(2), shortcut: 'Ctrl+2' },
  { id: '1+2', label: '1 + 2', panes: 3, template: { dir: 'row', children: ['p', { dir: 'column', children: ['p', 'p'] }] }, shortcut: 'Ctrl+3' },
  { id: '2x2', label: '2 × 2', panes: 4, template: { dir: 'column', children: [row(2), row(2)] }, shortcut: 'Ctrl+4' },
  { id: '3x2', label: '3 × 2', panes: 6, template: { dir: 'column', children: [row(3), row(3)] }, shortcut: 'Ctrl+6' },
  { id: '4x2', label: '4 × 2', panes: 8, template: { dir: 'column', children: [row(4), row(4)] }, shortcut: 'Ctrl+8' },
  { id: '2h', label: '2 rows', panes: 2, template: { dir: 'column', children: ['p', 'p'] } },
]

export const PRESET_IDS: readonly PresetId[] = PRESETS.map((preset) => preset.id)

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value)
}

export function presetDef(id: PresetId): PresetDef {
  return PRESETS.find((preset) => preset.id === id)!
}

/**
 * The preset that holds `count` panes at least: what the numbered layout shortcuts and the old
 * `layoutMode` of a saved snapshot (1..8 panes) map to.
 */
export function presetForPaneCount(count: number): PresetId {
  return PRESETS.find((preset) => preset.panes >= count)?.id ?? '4x2'
}

/** Shape of a layout tree with the ids removed. */
function shapeOf(node: LayoutNode): Template {
  if (node.kind === 'pane') return 'p'
  return { dir: node.dir, children: node.children.map(shapeOf) }
}

function sameShape(a: Template, b: Template): boolean {
  if (a === 'p' || b === 'p') return a === b
  return a.dir === b.dir && a.children.length === b.children.length && a.children.every((child, i) => sameShape(child, b.children[i]!))
}

/** The preset a layout tree has, or `custom` when the user split it some other way. */
export function detectPreset(layout: LayoutNode): DetectedPreset {
  const shape = shapeOf(layout)
  return PRESETS.find((preset) => sameShape(shape, preset.template))?.id ?? 'custom'
}

let splitSeq = 0

function build(template: Template, panes: string[]): LayoutNode {
  if (template === 'p') return { kind: 'pane', paneId: panes.shift()! }
  return { kind: 'split', id: `psplit${++splitSeq}`, dir: template.dir, children: template.children.map((child) => build(child, panes)) }
}

/** The panes that stay, in slot order: the active pane keeps its place, or takes the last slot. */
function keptPanes(order: string[], active: string, count: number): string[] {
  const index = order.indexOf(active)
  if (index < count) return order.slice(0, count)
  return [...order.slice(0, count - 1), active]
}

/** Fills each new, empty pane with a tab that is not active in the pane it leaves (the most crowded one). */
function fillNewPanes(input: TabsState, fresh: string[]): TabsState {
  let state = input
  for (const target of fresh) {
    let source: { paneId: string; tabId: string } | null = null
    let most = 0
    for (const pane of Object.values(state.panes)) {
      if (fresh.includes(pane.id)) continue
      const spare = pane.tabs.filter((tab) => tab.id !== pane.active && !tab.pinned)
      if (pane.tabs.length > 1 && spare.length > most) {
        most = spare.length
        source = { paneId: pane.id, tabId: spare[spare.length - 1]!.id }
      }
    }
    if (!source) break
    state = moveTab(state, source.paneId, source.tabId, target, 0)
  }
  return state
}

/** Moves every tab of the dropped panes onto the last kept pane; the target keeps its own active tab. */
function mergeDroppedPanes(input: TabsState, dropped: string[], target: string): TabsState {
  let state = input
  const previouslyActive = state.panes[target]?.active ?? null
  for (const id of dropped) {
    const tabs = state.panes[id]?.tabs.map((tab) => tab.id) ?? []
    for (const tabId of tabs) {
      const into = state.panes[target]
      if (!into) return state
      state = moveTab(state, id, tabId, target, into.tabs.length)
    }
  }
  if (previouslyActive && state.panes[target]?.tabs.some((tab) => tab.id === previouslyActive)) {
    state = activateTab(state, target, previouslyActive)
  }
  return state
}

/**
 * Rearranges the editor into `preset`. Pane ids and tab ids survive wherever they can (a terminal
 * survives only while its tab does): growing adds empty panes and lends them tabs from crowded ones,
 * shrinking moves a dropped pane's tabs onto the last kept pane. The active pane stays active.
 * Pure; the caller commits the result.
 */
export function applyPreset(state: TabsState, preset: PresetId): TabsState {
  const def = presetDef(preset)
  if (detectPreset(state.layout) === preset) return state
  const active = state.activePane
  let current = state
  let order = paneIds(current)
  const fresh: string[] = []
  while (order.length < def.panes) {
    const split = splitAtEdge(current, order[order.length - 1]!, 'right')
    current = split.state
    fresh.push(split.paneId)
    order = [...order, split.paneId]
  }
  const kept = keptPanes(order, active, def.panes)
  const dropped = order.filter((id) => !kept.includes(id))
  current = fresh.length > 0 ? fillNewPanes(current, fresh) : current
  if (dropped.length > 0) current = mergeDroppedPanes(current, dropped, kept[kept.length - 1]!)
  const panes = Object.fromEntries(kept.filter((id) => current.panes[id]).map((id) => [id, current.panes[id]!]))
  const layout = build(def.template, kept.slice())
  return { ...current, layout, panes, activePane: active }
}

/** What a maximize remembers to restore the previous arrangement. */
export interface MaximizeSnapshot {
  preset: DetectedPreset
  /** Every tab with the index of the pane it was in, in pane order. */
  tabs: { key: string; pane: number }[]
  /** The active tab key of each pane, by pane index. */
  active: (string | null)[]
  activePane: number
}

export function snapshotPanes(state: TabsState, preset: DetectedPreset): MaximizeSnapshot {
  const order = paneIds(state)
  const tabs = order.flatMap((id, pane) => state.panes[id]!.tabs.map((tab) => ({ key: tab.input.key, pane })))
  const active = order.map((id) => {
    const pane = state.panes[id]!
    return pane.tabs.find((tab) => tab.id === pane.active)?.input.key ?? null
  })
  return { preset, tabs, active, activePane: Math.max(0, order.indexOf(state.activePane)) }
}

/**
 * Puts every tab back into the pane it had before the maximize (tab ids stay, so terminals stay
 * mounted). A snapshot of a custom layout restores to the closest preset. Tabs opened meanwhile
 * stay in the pane they are in, or in the active pane when that no longer exists.
 */
export function restorePanes(state: TabsState, snapshot: MaximizeSnapshot): TabsState {
  const wanted = Math.max(1, ...snapshot.tabs.map((item) => item.pane + 1), snapshot.active.length)
  const preset = snapshot.preset === 'custom' ? presetForPaneCount(wanted) : snapshot.preset
  const def = presetDef(preset)
  const base = applyPreset(state, preset)
  const order = paneIds(base)
  const slot = (index: number) => order[Math.min(index, order.length - 1)]!
  const byKey = new Map(Object.values(base.panes).flatMap((pane) => pane.tabs.map((tab) => [tab.input.key, { tab, from: pane.id }] as const)))
  const lists = new Map<string, Tab[]>(order.map((id) => [id, []]))
  const taken = new Set<string>()
  for (const { key, pane } of snapshot.tabs) {
    const found = byKey.get(key)
    if (!found || taken.has(key)) continue
    taken.add(key)
    lists.get(slot(Math.min(pane, def.panes - 1)))!.push(found.tab)
  }
  for (const pane of Object.values(base.panes)) {
    for (const tab of pane.tabs) {
      if (!taken.has(tab.input.key)) lists.get(lists.has(pane.id) ? pane.id : base.activePane)!.push(tab)
    }
  }
  const panes = Object.fromEntries(
    order.map((id) => {
      const tabs = lists.get(id)!
      const key = snapshot.active[order.indexOf(id)]
      const active = tabs.find((tab) => tab.input.key === key) ?? tabs.find((tab) => tab.id === base.panes[id]?.active) ?? tabs[0] ?? null
      const mru = [...(active ? [active.id] : []), ...(base.panes[id]?.mru ?? []).filter((tabId) => tabId !== active?.id && tabs.some((tab) => tab.id === tabId))]
      return [id, { id, tabs, active: active?.id ?? null, mru }]
    }),
  )
  return { ...base, panes, activePane: slot(snapshot.activePane) }
}
