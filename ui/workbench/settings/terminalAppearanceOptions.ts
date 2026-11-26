import { COLOR_SCHEMES, FOLLOW_THEME } from '../../terminal/colorSchemes'
import type { TerminalLookSettings } from '../../terminal/terminalLook'

type Option = { value: string; label: string }

/** Minimum contrast choices; `auto` is stored as the string, the rest as numbers. */
const CONTRAST_CHOICES: readonly Option[] = [
  { value: 'auto', label: 'Auto (off on dark palettes)' },
  { value: '1', label: 'Off — exact colors' },
  { value: '2', label: 'Low' },
  { value: '3', label: 'Medium' },
  { value: '4.5', label: 'High (WCAG AA)' },
  { value: '7', label: 'Maximum (WCAG AAA)' },
]

/** The scheme select's options: following the theme, the presets, then the imported schemes. */
export function schemeOptions(look: TerminalLookSettings): Option[] {
  return [
    { value: FOLLOW_THEME, label: 'Follow app theme' },
    ...COLOR_SCHEMES.map(s => ({ value: s.id, label: s.name })),
    ...look.customSchemes.map(s => ({ value: s.id, label: `${s.name} (imported)` })),
  ]
}

/** The stored contrast as a select value; a hand-edited ratio between the choices is listed too. */
export function contrastOptions(look: TerminalLookSettings): Option[] {
  const value = String(look.minContrast)
  return CONTRAST_CHOICES.some(c => c.value === value)
    ? [...CONTRAST_CHOICES]
    : [...CONTRAST_CHOICES, { value, label: `Custom (${value})` }]
}
