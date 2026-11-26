import type { TerminalTheme } from '../themes'

import { paletteOf } from './colorSchemes'

/**
 * Reads an iTerm2 `.itermcolors` file: a property list whose top-level dict maps names such as
 * `Ansi 0 Color` or `Background Color` to dicts of `Red/Green/Blue Component` reals in 0…1. The
 * file comes from the user's disk and is untrusted, so anything malformed yields `null`.
 */

type Rgb = { r: number; g: number; b: number }

const channel = (value: number): string =>
  Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')

const toHex = ({ r, g, b }: Rgb): string => `#${channel(r)}${channel(g)}${channel(b)}`

/** The `<key>`/value pairs of a plist `<dict>`, in document order. */
function dictEntries(dict: Element): Array<[string, Element]> {
  const entries: Array<[string, Element]> = []
  const children = Array.from(dict.children)
  for (let i = 0; i + 1 < children.length; i++) {
    const key = children[i]
    const value = children[i + 1]
    if (key?.tagName !== 'key' || !value) continue
    entries.push([key.textContent?.trim() ?? '', value])
    i++
  }
  return entries
}

function readColor(value: Element): Rgb | null {
  if (value.tagName !== 'dict') return null
  const components = new Map<string, number>()
  for (const [key, el] of dictEntries(value)) {
    if (el.tagName !== 'real' && el.tagName !== 'integer') continue
    const n = Number(el.textContent)
    if (Number.isFinite(n)) components.set(key, n)
  }
  const r = components.get('Red Component')
  const g = components.get('Green Component')
  const b = components.get('Blue Component')
  return r === undefined || g === undefined || b === undefined ? null : { r, g, b }
}

/** The palette of an `.itermcolors` file, or `null` when it lacks the 16 ANSI colors or a background. */
export function parseItermColors(xml: string): TerminalTheme | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const root = doc.documentElement.tagName === 'plist'
    ? Array.from(doc.documentElement.children).find(el => el.tagName === 'dict')
    : undefined
  if (!root) return null
  const colors = new Map<string, string>()
  for (const [key, value] of dictEntries(root)) {
    const rgb = readColor(value)
    if (rgb) colors.set(key, toHex(rgb))
  }
  const ansi = Array.from({ length: 16 }, (_, i) => colors.get(`Ansi ${i} Color`))
    .filter((c): c is string => c !== undefined)
  const background = colors.get('Background Color')
  const foreground = colors.get('Foreground Color')
  if (!background || !foreground || ansi.length !== 16) return null
  const palette = paletteOf(
    {
      background,
      foreground,
      cursor: colors.get('Cursor Color') ?? foreground,
      selection: colors.get('Selection Color') ?? ansi[8] ?? foreground,
    },
    ansi,
  )
  const cursorText = colors.get('Cursor Text Color')
  const selectedText = colors.get('Selected Text Color')
  return {
    ...palette,
    ...(cursorText ? { cursorAccent: cursorText } : {}),
    ...(selectedText ? { selectionForeground: selectedText } : {}),
  }
}
