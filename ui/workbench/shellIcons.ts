import { registerExternalIcons } from '../ide/ui'

// Stroke colour #6C707E is the icon set's standard grey; the renderer rewrites it to currentColor.
const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
const STROKE = 'stroke="#6C707E" stroke-linejoin="round" stroke-linecap="round"'

/** Icon of the Sessions tool window: sparkles (the mock's "agent" glyph). */
export const SESSIONS_ICON = 'ext:omniterm/sessions'
/** Icon of the Sticky Notes tool window: a note with a folded corner. */
export const STICKY_NOTES_ICON = 'ext:omniterm/sticky-notes'
/** Icon of the Agents tool window (right stripe): a robot head, so it never matches Sessions. */
export const AGENT_TASKS_ICON = 'ext:omniterm/agent-tasks'

const ICONS: ReadonlyArray<readonly [string, string]> = [
  [
    STICKY_NOTES_ICON,
    svg(`<path d="M3 2.5h10v7L9.5 13.5H3z" ${STROKE}/><path d="M13 9.5H9.5v4M5.5 6h5M5.5 8.5h3" ${STROKE}/>`),
  ],
  [
    SESSIONS_ICON,
    svg(
      `<path d="M7 2.5l1.4 3.6 3.6 1.4-3.6 1.4L7 12.5 5.6 8.9 2 7.5l3.6-1.4z" ${STROKE}/><path d="M12.5 2v3M11 3.5h3M12 10.5v3M10.5 12h3" ${STROKE}/>`,
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
