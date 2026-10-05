/**
 * Constructors for the preview workers — the only place that touches `Worker`, so tests replace this
 * module instead of the global.
 *
 * Each `new URL(...)` must sit directly inside `new Worker(...)`: that exact shape is how Vite finds
 * and bundles a worker entry. Module workers load from the app origin, which the CSP's
 * `script-src 'self'` admits (a `blob:` worker would be refused).
 */

export function createCsvWorker(): Worker {
  return new Worker(new URL('./csv.worker.ts', import.meta.url), { type: 'module' })
}

export function createJsonGraphWorker(): Worker {
  return new Worker(new URL('./jsonGraph.worker.ts', import.meta.url), { type: 'module' })
}
