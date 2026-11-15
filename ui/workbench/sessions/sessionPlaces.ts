import { publishTabPlaces, type TabPlace } from '../../ide/editor/core/view/tabPlaces'
import { agentBrandFor, agentLabel, agentTooltip } from '../../utils/agentIdentity'
import { getPanePresence, subscribePanePresence, type PanePresence } from '../../utils/agentPresenceStore'

import { useSessionBridge, type SessionInfo } from './sessionBridge'
import { sessionIconName } from './sessionIcons'
import { SESSION_KEY_PREFIX, sessionInput } from './sessionInput'

/** `D:\work\app\` as the editor writes folders: `D:/work/app`. */
export function editorDir(dir: string): string {
  const slashed = dir.replace(/\\/g, '/').replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`)
  const trimmed = slashed.replace(/\/+$/, '')
  return trimmed === '' || /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/**
 * Where a session runs, for the navigation bar: its folder › the shell or the agent in it, like a
 * file's path (`project › src › PowerShell 7`); a remote session's host stands in for the folder.
 */
export function sessionPlace(session: SessionInfo, presence: PanePresence | undefined): TabPlace {
  const brand = agentBrandFor(presence?.agent)
  const local = session.connType === 'LOCAL'
  const shell = session.shellLabel || session.name
  return {
    dir: local && session.cwd ? editorDir(session.cwd) : null,
    host: local ? null : (session.location ?? null),
    label: brand ? agentLabel(brand) : shell,
    icon: sessionIconName(session.id),
    title: brand ? agentTooltip(brand, presence?.profileName) : session.name,
  }
}

/** Publishes every session tab's place (see `sessionPlace`) and keeps it current. */
export function registerSessionPlaces(): () => void {
  let signature = ''
  const refresh = () => {
    const places: Record<string, TabPlace> = {}
    for (const session of useSessionBridge.getState().sessions)
      places[sessionInput(session.id).key] = sessionPlace(session, getPanePresence(session.id))
    const next = JSON.stringify(places)
    if (next === signature) return
    signature = next
    publishTabPlaces(SESSION_KEY_PREFIX, places)
  }
  refresh()
  const stops = [useSessionBridge.subscribe(refresh), subscribePanePresence(refresh)]
  return () => {
    stops.forEach((stop) => stop())
    publishTabPlaces(SESSION_KEY_PREFIX, {})
  }
}
