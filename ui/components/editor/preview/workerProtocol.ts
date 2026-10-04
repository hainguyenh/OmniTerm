/**
 * Request/response envelope shared by the preview workers and their main-thread fallback.
 *
 * Every request carries an id so the caller can drop replies to requests it has since superseded;
 * every handler failure comes back as a value, never as an uncaught error inside the worker.
 */

export interface WorkerRequest {
  id: number
  payload: unknown
}

export type WorkerResponse<R> =
  | { id: number; ok: true; result: R }
  | { id: number; ok: false; error: string }

export interface HandlerResult<R> {
  result: R
  /** Buffers to move to the receiver instead of copying (a large `Uint32Array`, say). */
  transfer?: Transferable[]
}

export type WorkerHandler<R> = (payload: unknown) => HandlerResult<R>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Shape check for a reply. The result type is the handler's own contract and is not re-validated:
 *  both ends are this module's code, built together. */
export function isWorkerResponse<R>(value: unknown): value is WorkerResponse<R> {
  return isRecord(value) && typeof value.id === 'number' && typeof value.ok === 'boolean'
}

/** Run `handler` for one raw request and build the reply, catching anything it throws. */
export function respond<R>(
  data: unknown,
  handler: WorkerHandler<R>,
): { message: WorkerResponse<R>; transfer: Transferable[] } {
  const id = isRecord(data) && typeof data.id === 'number' ? data.id : -1
  try {
    if (id < 0 || !isRecord(data)) throw new Error('Malformed preview request')
    const { result, transfer = [] } = handler(data.payload)
    return { message: { id, ok: true, result }, transfer }
  } catch (error) {
    return { message: { id, ok: false, error: error instanceof Error ? error.message : String(error) }, transfer: [] }
  }
}
