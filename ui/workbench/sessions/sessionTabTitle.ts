import { sessionDisplayName } from '../../utils/sessionDisplayName'

import type { SessionInfo } from './sessionBridge'

const SEPARATOR = /[\\/]/

/** The last segment of a folder path (`D:\work\OmniTerm\` -> `OmniTerm`); null for a root or nothing. */
export function folderName(path: string | null | undefined): string | null {
  const parts = (path ?? '').split(SEPARATOR).filter(Boolean)
  const last = parts.at(-1)
  // `D:` alone is a drive root, not a folder name worth showing.
  return last && !/^[A-Za-z]:$/.test(last) ? last : null
}

/**
 * The label of a session tab: what runs, then the folder it works in for a local shell
 * (`pwsh — OmniTerm`). An agent tab shows the agent alone (its badge says what it is), and a title
 * that already names the folder is not repeated.
 */
export function sessionTabTitle(session: Pick<SessionInfo, 'name' | 'connType' | 'cwd'> | undefined, agent: boolean): string {
  const name = (session && sessionDisplayName(session.name)) || 'Terminal'
  if (!session || agent || session.connType !== 'LOCAL') return name
  const folder = folderName(session.cwd)
  if (!folder || name.toLowerCase().includes(folder.toLowerCase())) return name
  return `${name} \u2014 ${folder}`
}
