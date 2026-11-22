import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

import type { TerminalTheme } from '../themes'
import { minimumContrastFor, resolveTerminalFontFamily, type TerminalLookOptions } from '../utils/terminalOptions'
import { normalizeXtermTheme } from '../utils/xtermTheme'

export interface PaneAppearance {
  theme?: TerminalTheme
  darkMode?: boolean
  look?: TerminalLookOptions
  fontSize?: number
  fontFamilyMono?: string
}

/**
 * Applies palette, contrast, bold and font changes to a live pane without recreating its terminal.
 * `refitRef` re-measures the grid after a font change.
 */
export function useTerminalAppearance(
  termRef: RefObject<Terminal | null>,
  refitRef: RefObject<() => void>,
  { theme, darkMode, look, fontSize, fontFamilyMono }: PaneAppearance,
): void {
  const lightPalette = look?.lightPalette ?? darkMode === false
  const contrast = minimumContrastFor(darkMode, look)
  const boldBright = look?.boldBright ?? true

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.minimumContrastRatio = contrast
    term.options.drawBoldTextInBrightColors = boldBright
    if (theme) term.options.theme = normalizeXtermTheme(theme, lightPalette)
  }, [termRef, theme, lightPalette, contrast, boldBright])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let changed = false
    if (fontSize && term.options.fontSize !== fontSize) {
      term.options.fontSize = fontSize
      changed = true
    }
    if (fontFamilyMono) {
      const family = resolveTerminalFontFamily(fontFamilyMono)
      if (term.options.fontFamily !== family) {
        term.options.fontFamily = family
        changed = true
      }
    }
    if (changed) requestAnimationFrame(() => refitRef.current())
  }, [termRef, refitRef, fontSize, fontFamilyMono])
}
