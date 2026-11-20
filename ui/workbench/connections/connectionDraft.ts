import type { Connection } from '../../domain'

/** What the New / Edit connection form holds. No password: it is typed at the server's prompt. */
export interface ConnectionDraft {
  /** Empty for a new profile; the backend gives it an id. */
  id: string
  type: 'SSH' | 'RDP'
  name: string
  host: string
  port: string
  user: string
  redirectDrives: boolean
}

export type RemoteType = ConnectionDraft['type']

export function emptyDraft(type: RemoteType): ConnectionDraft {
  return { id: '', type, name: '', host: '', port: '', user: '', redirectDrives: false }
}

export function draftFromConnection(connection: Connection): ConnectionDraft {
  return {
    id: connection.id,
    type: connection.type === 'RDP' ? 'RDP' : 'SSH',
    name: connection.name,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    redirectDrives: connection.redirectDrives === true,
  }
}

/** A draft for an `ssh` the user ran in a terminal, named after its address. */
export function draftFromSsh(session: Pick<LocalSshSession, 'user' | 'host' | 'port'>): ConnectionDraft {
  return {
    ...emptyDraft('SSH'),
    name: session.user ? `${session.user}@${session.host}` : session.host,
    host: session.host,
    port: session.port ?? '',
    user: session.user ?? '',
  }
}

/** One token that `ssh` / `mstsc` cannot misread as an option. */
const TOKEN = /^[^\s-][^\s]*$/

/**
 * Why the draft cannot be saved, or null. The same rules run again in the backend, which is the
 * one that decides; this only explains the problem before the round trip.
 */
export function draftProblem(draft: ConnectionDraft): string | null {
  const host = draft.host.trim()
  if (!host) return 'Enter the host to connect to.'
  if (!TOKEN.test(host)) return 'The host must be one name or address, without spaces.'
  const user = draft.user.trim()
  if (user && !TOKEN.test(user)) return 'The user name must be one word, without spaces.'
  const port = draft.port.trim()
  if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
    return 'The port must be a number from 1 to 65535.'
  }
  return null
}

/** The profile the backend stores for a draft. */
export function connectionFromDraft(draft: ConnectionDraft): Connection {
  return {
    id: draft.id,
    type: draft.type,
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: draft.port.trim(),
    user: draft.user.trim(),
    ...(draft.type === 'RDP' ? { redirectDrives: draft.redirectDrives } : {}),
  }
}
