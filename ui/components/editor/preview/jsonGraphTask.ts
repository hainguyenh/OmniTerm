import { layoutJsonGraph, type GraphLayout } from './jsonGraphLayout'
import { buildJsonGraph } from './jsonGraphModel'
import { jsonErrorOffset } from './jsonSyntax'
import type { HandlerResult } from './workerProtocol'

/**
 * The JSON graph job, shared by the worker and the main-thread fallback: parse, build, lay out.
 *
 * Invalid JSON is an expected result, not a failure — the preview shows where it broke and offers to
 * jump there. The parsed value is cached per text, so expanding or collapsing a node re-runs only the
 * (cheap) build and layout, never the parse.
 */

export type JsonGraphResult =
  | { ok: true; layout: GraphLayout }
  | { ok: false; message: string; offset: number | null; line: number | null; column: number | null }

let lastText: string | null = null
let lastValue: unknown = null

/** Where invalid JSON breaks, as an offset and a 1-based line and column. */
export function locateJsonError(text: string): { offset: number; line: number; column: number } | null {
  const offset = jsonErrorOffset(text)
  if (offset === null) return null
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { offset, line, column: offset - lineStart + 1 }
}

function readPayload(payload: unknown): { text: string; collapsed: string[] } {
  if (typeof payload !== 'object' || payload === null || !('text' in payload) || !('collapsed' in payload)
    || typeof payload.text !== 'string' || !Array.isArray(payload.collapsed)) {
    throw new Error('Malformed JSON graph request')
  }
  return { text: payload.text, collapsed: payload.collapsed.filter((id): id is string => typeof id === 'string') }
}

export function handleJsonGraphRequest(payload: unknown): HandlerResult<JsonGraphResult> {
  const { text, collapsed } = readPayload(payload)
  if (text !== lastText) {
    try {
      lastValue = JSON.parse(text)
      lastText = text
    } catch (error) {
      lastText = null
      lastValue = null
      const message = error instanceof Error ? error.message : String(error)
      const where = locateJsonError(text)
      return {
        result: {
          ok: false, message, offset: where?.offset ?? null, line: where?.line ?? null, column: where?.column ?? null,
        },
      }
    }
  }
  const graph = buildJsonGraph(lastValue, { collapsed: new Set(collapsed) })
  return { result: { ok: true, layout: layoutJsonGraph(graph) } }
}
