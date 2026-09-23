export interface TerminalSize {
  cols: number
  rows: number
}

export interface ResizeQueue {
  push: (size: TerminalSize) => void
  cancel: () => void
}

/** Serialize PTY resizes while keeping only the newest size waiting to be sent. */
export const createLatestResizeQueue = (
  send: (size: TerminalSize) => void | PromiseLike<void>,
): ResizeQueue => {
  let pending: TerminalSize | null = null
  let running = false
  let cancelled = false

  const drain = async () => {
    if (running) return
    running = true
    while (pending && !cancelled) {
      const next = pending
      pending = null
      try {
        const result = send(next)
        if (result && typeof result.then === 'function') await result
      } catch {
        // The session may have exited while a resize was in flight. A later fit can retry it.
      }
    }
    running = false
  }

  return {
    push: (size) => {
      if (cancelled) return
      pending = size
      void drain()
    },
    cancel: () => {
      cancelled = true
      pending = null
    },
  }
}

/** Observe both the xterm host and its pane; some WebView2 resize paths update only the wrapper. */
export const observeTerminalResize = (target: HTMLElement, onResize: () => void): (() => void) => {
  const observer = new ResizeObserver(onResize)
  observer.observe(target)
  const parent = target.parentElement
  if (parent) observer.observe(parent)

  window.addEventListener('resize', onResize)
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', onResize)
  }
}
