import { diag } from '../../diag'
import { editorController, fileKey, useTabs } from '../../ide/editor/core/controller'
import { findTab, paneIds } from '../../ide/editor/core/model/tabs'
import { editorTabId } from '../../hooks/useScriptRuns'
import { applyEditorPreset } from '../layout/layoutPresetStore'

import { sessionInput } from './sessionInput'

const TAB_WAIT_MS = 10_000

/** The file a script's legacy editor id (`editor#<path>`) names. */
export function scriptPathOf(editorId: string): string | null {
  const prefix = editorTabId('')
  return editorId.startsWith(prefix) && editorId.length > prefix.length ? editorId.slice(prefix.length) : null
}

/** Whether the file is open in some pane of the editor. */
export function isScriptFileOpen(editorId: string): boolean {
  const path = scriptPathOf(editorId)
  return path !== null && findTab(useTabs.getState(), fileKey(path)) !== null
}

/** Resolves once a tab with `key` exists (a new session's tab arrives after its shell opened), or after a timeout. */
function whenTabExists(key: string): Promise<boolean> {
  if (findTab(useTabs.getState(), key)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (found: boolean) => {
      clearTimeout(timer)
      stop()
      resolve(found)
    }
    const stop = useTabs.subscribe((state) => {
      if (findTab(state, key)) finish(true)
    })
    const timer = setTimeout(() => finish(false), TAB_WAIT_MS)
  })
}

/** Opens a script's file in the editor (focused). */
export function openScriptFile(path: string): void {
  editorController().openFile(path, { focus: true }).catch((error: unknown) => diag.warn('[scripts] could not open the file', error))
}

/**
 * A script run next to its file: the file opens in the first pane and the run's session tab goes to
 * the second (two panes are made when the editor has one). Both tabs keep their identity, so the
 * run's terminal is not rebuilt.
 */
export async function pairRunWithFile(sessionId: string, editorId: string): Promise<void> {
  const path = scriptPathOf(editorId)
  if (!path) return
  if (paneIds(useTabs.getState()).length < 2 && !applyEditorPreset('2')) return
  const [first, second] = paneIds(useTabs.getState())
  if (!first || !second) return
  await editorController().openFile(path, { pane: first, focus: false })
  if (!(await whenTabExists(sessionInput(sessionId).key))) return
  const home = findTab(useTabs.getState(), sessionInput(sessionId).key)
  const target = useTabs.getState().panes[second]
  if (!home || !target) return
  if (home.paneId !== second) editorController().moveTab(home.paneId, home.tab.id, second, target.tabs.length)
  editorController().activate(second, home.tab.id)
}
