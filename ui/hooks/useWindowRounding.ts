import { useEffect, useState } from 'react'

/**
 * Whether this window should paint the rounded shell (`app-window-rounded`).
 *
 * On Windows the window is created transparent and shadowless (tauri.windows.conf.json) and CSS
 * owns the corner radius; macOS keeps its native window rounding and Linux an opaque square
 * window, so neither rounds here. The radius is suppressed while the window is maximized or
 * fullscreen — a maximized window covers the screen, and leaving the radius on would show the
 * desktop at the corners.
 */
export function useWindowRounding(): boolean {
  const isWindows = window.omnitermAPI?.app?.platform === 'win32'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isWindows) return
    let alive = true
    window.omnitermAPI.windowControl.isMaximized()
      .then((value) => { if (alive) setMaximized(value) })
      .catch(() => {})
    const stop = window.omnitermAPI.windowControl.onMaximizedState((value) => setMaximized(value))
    return () => { alive = false; stop() }
  }, [isWindows])

  return isWindows && !maximized
}