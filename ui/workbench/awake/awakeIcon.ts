/** Always Awake: a crescent moon with a star (the activity bar's MoonStar). */
export const AWAKE_ICON = 'ext:omniterm/always-awake'

// Stroke colour #6C707E is the icon set's standard grey; the renderer rewrites it to currentColor.
const STROKE = 'stroke="#6C707E" stroke-linejoin="round" stroke-linecap="round"'

export const AWAKE_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + `<path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.3 4.3 0 0 0 6.6 6.6z" ${STROKE}/>`
  + `<path d="M11.5 1.5v3M10 3h3" ${STROKE}/>`
  + '</svg>'
