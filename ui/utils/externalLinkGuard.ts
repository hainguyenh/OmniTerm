import { isTauri } from '../ide/platform/ipc'
import { openExternalUrl } from '../ide/platform/openUrl'

/**
 * Web pages never load inside the app window. In the desktop build `window.open(url)` and a plain
 * `<a href>` both act on the webview itself: one pops a bare browser window over the app, the other
 * replaces the whole UI (every pane with it) with no way back. Either way a link belongs in the
 * system's default browser, so both are routed there.
 *
 * Only http(s) and mailto links outside the app's own origin are taken; everything else (the app's
 * own pages, blob previews, `#` anchors) keeps the browser's behaviour.
 */
export const externalHref = (raw: string | URL | null | undefined, origin: string): string | null => {
  if (!raw) return null
  try {
    const url = new URL(String(raw), origin)
    if (url.protocol === 'mailto:') return url.href
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin === origin ? null : url.href
  } catch {
    return null
  }
}

const anchorOf = (target: EventTarget | null): HTMLAnchorElement | null =>
  target instanceof Element ? target.closest('a[href]') : null

/** Install once per window, before the first render. Returns the uninstaller (for tests). */
export const installExternalLinkGuard = (
  win: Window = window,
  open: (url: string) => Promise<void> = openExternalUrl,
): (() => void) => {
  const origin = win.location.origin
  const nativeOpen = win.open.bind(win)
  win.open = (url?: string | URL, target?: string, features?: string) => {
    const href = externalHref(url, origin)
    if (!href) return nativeOpen(url, target, features)
    void open(href).catch(() => {})
    return null
  }
  // Bubble phase on the window: runs after React's handlers, so a link a component already
  // handled (and prevented) is left alone.
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return
    const href = externalHref(anchorOf(event.target)?.getAttribute('href'), origin)
    if (!href) return
    event.preventDefault()
    void open(href).catch(() => {})
  }
  win.addEventListener('click', onClick)
  win.addEventListener('auxclick', onClick)
  return () => {
    win.open = nativeOpen
    win.removeEventListener('click', onClick)
    win.removeEventListener('auxclick', onClick)
  }
}

/** The desktop build's guard; a plain browser (tests, `vite dev` in a browser) keeps its tabs. */
export const guardExternalLinks = (): void => {
  if (isTauri()) installExternalLinkGuard()
}
