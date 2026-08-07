import type { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { acquire, release, touch } from './webglPool'

export interface WebglController {
  load: () => void
  unload: () => void
  /** Mark this pane as recently used so the shared pool evicts a colder one first. */
  touch: () => void
}

/**
 * Owns the WebGL renderer addon for one xterm `Terminal`.
 *
 * The DOM renderer (xterm's fallback with no renderer addon loaded) draws every glyph as a styled
 * `<span>` — the slowest option, and fully exposed to the app's own CSS. WebGL draws from a GPU
 * texture atlas instead.
 *
 * The addon is loaded when the pane first has real dimensions and is not tied to visibility:
 * reloading it on each hidden→visible edge rebuilt the texture atlas from empty, and painting from an
 * empty atlas is what the white/black flash on a tab switch was. Pool eviction or context loss can
 * still drop it; the next active fit retries the load. Staying under the browser's context cap is
 * webglPool.ts's job.
 */
export const createWebglController = (term: Terminal): WebglController => {
  let webgl: WebglAddon | undefined
  let retryLoad = true
  // Pool identity. The Terminal itself would do, but a dedicated token keeps the pool from holding a
  // reference to a disposed terminal if a `release` is ever missed.
  const slot = {}

  const refreshDom = () => {
    try {
      term.refresh(0, Math.max(0, term.rows - 1))
    } catch {
      // The terminal can be disposing while a browser context-loss event is delivered.
    }
  }

  const drop = () => {
    try {
      webgl?.dispose()
    } catch {
      // Ignore xterm addon disposal errors
    }
    webgl = undefined
    retryLoad = true
    refreshDom()
  }

  const load = () => {
    if (webgl || !retryLoad) return
    retryLoad = false
    try {
      const addon = new WebglAddon()
      // A lost context (GPU reset, driver issue, budget exhaustion) degrades to the DOM renderer
      // rather than throwing past the caller or leaving the pane blank.
      addon.onContextLoss(() => {
        addon.dispose()
        if (webgl === addon) {
          webgl = undefined
          release(slot)
          retryLoad = true
          refreshDom()
        }
      })
      term.loadAddon(addon)
      webgl = addon
      // After the context exists, so a pane that could not get one does not occupy a slot.
      acquire(slot, drop)
    } catch {
      /* WebGL unavailable (software rendering, driver issue) — stay on the DOM renderer */
    }
  }

  const unload = () => {
    try {
      webgl?.dispose()
    } catch {
      // Ignore xterm addon disposal errors
    }
    webgl = undefined
    retryLoad = false
    refreshDom()
    release(slot)
  }

  return { load, unload, touch: () => touch(slot) }
}
