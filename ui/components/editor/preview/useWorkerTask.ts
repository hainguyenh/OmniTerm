import { useCallback, useEffect, useRef, useState } from 'react'

import { isWorkerResponse, respond, type WorkerHandler, type WorkerResponse } from './workerProtocol'

export interface WorkerTaskState<P, R> {
  status: 'idle' | 'running' | 'done' | 'error'
  /** The last successful result, kept while a newer request runs so the preview does not flicker. */
  result: R | null
  /** The payload `result` was computed from. */
  input: P | null
  error: string | null
}

interface Options {
  /** Size of the payload in characters, to decide whether the main-thread fallback is affordable. */
  size: number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
/** Without a worker, only this much is parsed on the main thread — beyond it the UI would stall. */
const FALLBACK_LIMIT = 512 * 1024

/**
 * Run `handler` on a background worker for each new `payload` (memoize it — identity is the trigger).
 *
 * The latest request always wins: a request still running when a newer one arrives is cancelled by
 * terminating the worker, so a burst of edits never queues stale parses. A worker that exceeds the
 * timeout is terminated too. If workers are unavailable at all, small inputs run on the main thread
 * through the same handler.
 */
export function useWorkerTask<P, R>(
  createWorker: () => Worker,
  handler: WorkerHandler<R>,
  payload: P | null,
  { size, timeoutMs = DEFAULT_TIMEOUT_MS }: Options,
) {
  const [state, setState] = useState<WorkerTaskState<P, R>>({ status: 'idle', result: null, input: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const idRef = useRef(0)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const dropWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    busyRef.current = false
  }, [])

  useEffect(() => {
    if (payload === null) return
    const id = ++idRef.current
    const apply = (message: WorkerResponse<R>) => {
      if (message.id !== idRef.current) return
      setState((prev) => (message.ok
        ? { status: 'done', result: message.result, input: payload, error: null }
        : { ...prev, status: 'error', error: message.error }))
    }
    setState((prev) => ({ ...prev, status: 'running', error: null }))

    if (busyRef.current) dropWorker()
    if (!workerRef.current) {
      try {
        workerRef.current = createWorker()
      } catch {
        workerRef.current = null
      }
    }
    const worker = workerRef.current
    if (!worker) {
      if (sizeRef.current > FALLBACK_LIMIT) {
        setState((prev) => ({ ...prev, status: 'error', error: 'This preview needs a background worker, which is unavailable.' }))
        return
      }
      apply(respond({ id, payload }, handler).message)
      return
    }

    busyRef.current = true
    const timer = setTimeout(() => {
      if (idRef.current !== id) return
      dropWorker()
      setState((prev) => ({ ...prev, status: 'error', error: 'Preview took too long and was stopped.' }))
    }, timeoutMs)
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse<R>(event.data) || event.data.id !== id) return
      clearTimeout(timer)
      busyRef.current = false
      apply(event.data)
    }
    const onError = () => {
      clearTimeout(timer)
      dropWorker()
      if (idRef.current === id) setState((prev) => ({ ...prev, status: 'error', error: 'Preview failed to render.' }))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ id, payload })
    return () => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
  }, [payload, attempt, createWorker, handler, timeoutMs, dropWorker])

  useEffect(() => dropWorker, [dropWorker])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}
