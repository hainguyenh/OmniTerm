import { useEffect, useSyncExternalStore } from 'react'

import { useTabs } from '../../ide/editor/core/controller'
import { neighbourPane, paneIds, setActivePane } from '../../ide/editor/core/model/tabs'
import { registerAction } from '../../ide/platform/actions'
import { useSessionBridge } from '../sessions/sessionBridge'
import { parseSessionInput } from '../sessions/sessionInput'

import {
  applyEditorPreset,
  isMaximized,
  maximizeActivePane,
  restoreMaximized,
  startPresetRestorer,
  subscribeMaximized,
} from './layoutPresetStore'
import { registerPaneTitleActions, TOGGLE_MAXIMIZE_PANE } from './paneTitleActions'
import { detectPreset, presetForPaneCount, type DetectedPreset, type PresetId } from './layoutPresets'
import { effectiveZoom, setZoomOverride, stepZoom, useSessionZoom, zoomKey } from './sessionZoom'
import { useEditorAreaSize } from './useEditorAreaSize'

/** The preset of the editor right now (`custom` for a layout the user split by hand). */
export function useCurrentPreset(): DetectedPreset {
  return useTabs((state) => detectPreset(state.layout))
}

export function useMaximized(): boolean {
  return useSyncExternalStore(subscribeMaximized, isMaximized, isMaximized)
}

export interface ZoomModel {
  key: PresetId
  /** Whether this layout has a zoom at all (grids of four panes and more). */
  available: boolean
  zoom: number
  manual: boolean
  step: (direction: 1 | -1) => void
  auto: () => void
}

/** The terminal zoom in force for the editor's layout, and its controls. */
export function useSessionZoomModel(): ZoomModel {
  const preset = useCurrentPreset()
  const count = useTabs((state) => paneIds(state).length)
  const area = useEditorAreaSize()
  const overrides = useSessionZoom((state) => state.overrides)
  const key = zoomKey(preset, count)
  const zoom = effectiveZoom(key, area, overrides)
  return {
    key,
    available: count >= 4,
    zoom,
    manual: overrides[key] !== undefined,
    step: (direction) => setZoomOverride(key, stepZoom(zoom, direction)),
    auto: () => setZoomOverride(key, null),
  }
}

/** The font zoom the terminals use: 1 while a layout has no zoom. */
export function useTerminalZoom(): number {
  const { zoom } = useSessionZoomModel()
  return zoom
}

/**
 * Ctrl+Shift+N: a new shell in the working folder of the active session, opened in the next pane
 * (a single pane becomes two first). Returns false when there is no session to copy.
 */
export function openSessionInNextPane(): boolean {
  const state = useTabs.getState()
  const activeTab = state.panes[state.activePane]?.tabs.find((tab) => tab.id === state.panes[state.activePane]?.active)
  const sessionId = parseSessionInput(activeTab?.input)
    ?? Object.values(state.panes).flatMap((pane) => pane.tabs).map((tab) => parseSessionInput(tab.input)).find((id) => id !== null)
    ?? null
  const api = useSessionBridge.getState().api
  if (!sessionId || !api) return false
  if (paneIds(state).length < 2 && !applyEditorPreset('2')) return false
  const next = neighbourPane(useTabs.getState(), useTabs.getState().activePane)
  if (next) useTabs.setState(setActivePane(useTabs.getState(), next), true)
  api.newSessionLike(sessionId)
  return true
}

/**
 * Window-level wiring of the layout presets: the numbered layout shortcuts (they arrive as
 * `omniterm:change-layout` events), Escape leaving a maximized pane, and bringing back a
 * project's preset once its tabs were restored.
 */
export function useLayoutPresetEffects(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined
    const onChange = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: unknown }>).detail?.mode
      if (typeof mode === 'number' && Number.isInteger(mode) && mode >= 1 && mode <= 8) applyEditorPreset(presetForPaneCount(mode))
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && restoreMaximized()) event.preventDefault()
    }
    const onNewPane = () => {
      openSessionInNextPane()
    }
    window.addEventListener('omniterm:change-layout', onChange)
    window.addEventListener('omniterm:new-pane-current-directory', onNewPane)
    window.addEventListener('keydown', onKey)
    const stopRestorer = startPresetRestorer()
    const stopAction = registerAction({
      id: TOGGLE_MAXIMIZE_PANE,
      title: 'Maximize / Restore Pane',
      category: 'Layout',
      icon: 'fullscreen',
      verbatim: true,
      run: () => {
        if (!restoreMaximized()) maximizeActivePane()
      },
    })
    const stopTitleActions = registerPaneTitleActions()
    return () => {
      stopTitleActions()
      stopAction()
      window.removeEventListener('omniterm:new-pane-current-directory', onNewPane)
      window.removeEventListener('omniterm:change-layout', onChange)
      window.removeEventListener('keydown', onKey)
      stopRestorer()
    }
  }, [enabled])
}
