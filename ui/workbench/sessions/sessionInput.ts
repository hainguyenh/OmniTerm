import type { EditorInput } from '../../ide/workbench/contributions'

/** Namespaced: unsandboxed plugins may register editor kinds too. */
export const SESSION_KIND = 'omniterm.session'

/** Printable, no whitespace: ids are connection ids, `<connId>_<random>` for local shells. */
const SESSION_ID = /^[^\s\u0000-\u001f\u007f]{1,200}$/
export const SESSION_KEY_PREFIX = 'session:'

/** The editor input of a session tab. Only the id is persisted: no host, user or folder. */
export function sessionInput(sessionId: string): EditorInput {
  return { kind: SESSION_KIND, key: `${SESSION_KEY_PREFIX}${sessionId}`, data: { sessionId } }
}

/**
 * The session id of an input, or null when it is no valid session input. Restored editor sessions
 * and drag payloads are untrusted, so `data` must agree with `key` and hold nothing but a plain id.
 */
export function parseSessionInput(input: EditorInput | null | undefined): string | null {
  if (!input || input.kind !== SESSION_KIND) return null
  const data = input.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const sessionId = (data as { sessionId?: unknown }).sessionId
  if (Object.keys(data).length !== 1 || typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  return input.key === `${SESSION_KEY_PREFIX}${sessionId}` ? sessionId : null
}
