import { registerExternalIcons } from '../ide/ui'

// Stroke colour #6C707E is the icon set's standard grey; the renderer rewrites it to currentColor.
const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
const STROKE = 'stroke="#6C707E" stroke-linejoin="round" stroke-linecap="round"'

/** Icon of the Sessions tool window: sparkles (the mock's "agent" glyph). */
export const SESSIONS_ICON = 'ext:omniterm/sessions'
/** Icon of the Connections tool window: three linked nodes. */
export const CONNECTIONS_ICON = 'ext:omniterm/connections'
/** Icon of the Agents tool window (right stripe): a robot head, so it never matches Sessions. */
export const AGENT_TASKS_ICON = 'ext:omniterm/agent-tasks'

/** Connection tree icons: a server rack (SSH group), a monitor (Remote Desktop), a plug (one SSH host). */
export const SERVER_ICON = 'ext:omniterm/server'
export const MONITOR_ICON = 'ext:omniterm/monitor'
export const PLUG_ICON = 'ext:omniterm/plug'

const ICONS: ReadonlyArray<readonly [string, string]> = [
  [
    SERVER_ICON,
    svg(
      `<rect x="2.5" y="2.5" width="11" height="4.5" rx="1" ${STROKE}/><rect x="2.5" y="9" width="11" height="4.5" rx="1" ${STROKE}/><path d="M5 4.75h.01M5 11.25h.01" ${STROKE}/>`,
    ),
  ],
  [
    MONITOR_ICON,
    svg(`<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" ${STROKE}/><path d="M8 11v2.5M5 13.5h6" ${STROKE}/>`),
  ],
  [
    PLUG_ICON,
    svg(`<path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0zM8 11.5v3" ${STROKE}/>`),
  ],
  [
    SESSIONS_ICON,
    svg(
      `<path d="M7 2.5l1.4 3.6 3.6 1.4-3.6 1.4L7 12.5 5.6 8.9 2 7.5l3.6-1.4z" ${STROKE}/><path d="M12.5 2v3M11 3.5h3M12 10.5v3M10.5 12h3" ${STROKE}/>`,
    ),
  ],
  [
    CONNECTIONS_ICON,
    svg(
      `<circle cx="3.5" cy="8" r="1.8" ${STROKE}/><circle cx="12.5" cy="3.5" r="1.8" ${STROKE}/><circle cx="12.5" cy="12.5" r="1.8" ${STROKE}/><path d="M5.2 7.2l5.6-2.9M5.2 8.8l5.6 2.9" ${STROKE}/>`,
    ),
  ],
  [
    AGENT_TASKS_ICON,
    svg(
      `<rect x="2.5" y="5" width="11" height="8" rx="2" ${STROKE}/><path d="M8 5V2.5M6 9v.5M10 9v.5M1 8.5v2M15 8.5v2" ${STROKE}/>`,
    ),
  ],
]

/** Registers the shell's own tool window icons; the returned function removes them. */
export function registerShellIcons(): () => void {
  return registerExternalIcons(ICONS)
}
