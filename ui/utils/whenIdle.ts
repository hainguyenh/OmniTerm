/**
 * Runs `run` once the window is idle (at the latest after `timeoutMs`), so work that nothing on
 * screen waits for does not compete with the first paint and the session restore at launch.
 * Where the platform has no idle callback it runs at once. Returns a function that cancels a run
 * still waiting.
 */
export function whenIdle(run: () => void, timeoutMs = 10_000): () => void {
  const request = globalThis.requestIdleCallback
  if (typeof request !== 'function') {
    run()
    return () => {}
  }
  const handle = request(() => run(), { timeout: timeoutMs })
  return () => globalThis.cancelIdleCallback?.(handle)
}
