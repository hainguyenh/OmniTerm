import { agentBrandFor } from '../../utils/agentIdentity'
import { getPanePresence } from '../../utils/agentPresenceStore'
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

/** The agent profile a session runs while an AI agent runs in it, for its tab label. */
export function agentProfileOf(id: string | null | undefined): string | null {
  const presence = getPanePresence(id)
  return agentBrandFor(presence?.agent) ? presence?.profileName || null : null
}

/**
 * The label of a session tab: what runs, then the folder it works in for a local shell
 * (`pwsh — OmniTerm`). An agent tab shows the agent profile it runs under (`claude-work`; its icon
 * says which agent), and a title that already names the folder is not repeated.
 */
export function sessionTabTitle(session: Pick<SessionInfo, 'name' | 'connType' | 'cwd'> | undefined, agentProfile: string | null): string {
  if (agentProfile) return agentProfile
  const name = (session && sessionDisplayName(session.name)) || 'Terminal'
  if (!session || session.connType !== 'LOCAL') return name
  const folder = folderName(session.cwd)
  if (!folder || name.toLowerCase().includes(folder.toLowerCase())) return name
  return `${name} \u2014 ${folder}`
}
