import { registerExternalIcons } from '../../ide/ui'

// Stroke colour #6C707E is the icon set's standard grey; the renderer rewrites it to currentColor.
const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
const STROKE = 'stroke="#6C707E" stroke-linejoin="round" stroke-linecap="round"'
// A window outline with the docked region marked, so left / right / strip / footer read apart.
const FRAME = `<rect x="1.5" y="3" width="13" height="10" rx="1.5" ${STROKE}/>`

/** Agent quota: a gauge. */
export const QUOTA_ICON = 'ext:omniterm/quota'
export const DOCK_ICONS = {
  left: 'ext:omniterm/dock-left',
  right: 'ext:omniterm/dock-right',
  stripL: 'ext:omniterm/dock-strip-left',
  stripR: 'ext:omniterm/dock-strip-right',
  footer: 'ext:omniterm/dock-footer',
} as const

const ICONS: ReadonlyArray<readonly [string, string]> = [
  [QUOTA_ICON, svg(`<path d="M2.5 11a5.5 5.5 0 1 1 11 0" ${STROKE}/><path d="M8 11l2.5-3" ${STROKE}/>`)],
  [DOCK_ICONS.left, svg(`${FRAME}<path d="M7 3v10M3.5 6h2M3.5 8h2M3.5 10h2" ${STROKE}/>`)],
  [DOCK_ICONS.right, svg(`${FRAME}<path d="M9 3v10M10.5 6h2M10.5 8h2M10.5 10h2" ${STROKE}/>`)],
  [DOCK_ICONS.stripL, svg(`${FRAME}<path d="M4.5 3v10" ${STROKE}/><path d="M3 10.5v-3" stroke-width="2" ${STROKE}/>`)],
  [DOCK_ICONS.stripR, svg(`${FRAME}<path d="M11.5 3v10" ${STROKE}/><path d="M13 10.5v-3" stroke-width="2" ${STROKE}/>`)],
  [DOCK_ICONS.footer, svg(`${FRAME}<path d="M1.5 10h13M4 11.5h4" ${STROKE}/>`)],
]

/** Registers the quota icons; the returned function removes them. */
export function registerQuotaIcons(): () => void {
  return registerExternalIcons(ICONS)
}
