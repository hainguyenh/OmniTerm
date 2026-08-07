import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppTheme } from '../../themes'
import type { ColorField, ThemeMode } from '../../utils/themeVars'

/**
 * The editable copy of a theme.
 *
 * Editing writes here and nowhere else, which is what makes the preview instant and the disk quiet:
 * the app used to write the JSON file on every keystroke and slider tick. Nothing leaves this hook
 * until the caller saves.
 */
export interface ThemeDraft {
  draft: AppTheme
  /** True when the draft differs from the theme it was loaded from. */
  dirty: boolean
  setName: (name: string) => void
  setColor: (field: ColorField, mode: ThemeMode, value: string) => void
  /** Set one key of `ui[mode]` — fonts, radii, padding, margins. */
  setUiField: (mode: ThemeMode, key: string, value: string) => void
  /** Discard the edits and go back to the loaded theme. */
  revert: () => void
  /** Load another theme's palette into this draft, keeping this theme's identity. */
  adoptPalette: (source: AppTheme) => void
}

const clone = (theme: AppTheme): AppTheme => ({
  ...theme,
  terminal: { dark: { ...theme.terminal.dark }, light: { ...theme.terminal.light } },
  // A theme that predates the `ui` block must keep it absent: spreading it into an empty object would
  // hand the editor a bag of undefined fonts and radii, and saving that would strip the theme of the
  // legacy fallbacks it was relying on.
  ui: theme.ui ? { dark: { ...theme.ui.dark }, light: { ...theme.ui.light } } : theme.ui,
})

export function useThemeDraft(source: AppTheme): ThemeDraft {
  const [draft, setDraft] = useState<AppTheme>(() => clone(source))
  const loadedId = useRef(source.id)

  // Switching to another theme in the sidebar loads it; a save that merely refreshes the list with the
  // same id must NOT clobber what is on screen, so the id — not the object identity — is the trigger.
  useEffect(() => {
    if (loadedId.current === source.id) return
    loadedId.current = source.id
    setDraft(clone(source))
  }, [source])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(source), [draft, source])

  const setName = useCallback((name: string) => setDraft((d) => ({ ...d, name })), [])

  const setColor = useCallback((field: ColorField, mode: ThemeMode, value: string) => {
    setDraft((d) => {
      if (field.source === 'terminal') {
        return { ...d, terminal: { ...d.terminal, [mode]: { ...d.terminal[mode], [field.key]: value } } }
      }
      return { ...d, ui: { ...d.ui, [mode]: { ...d.ui?.[mode], [field.key]: value } } as AppTheme['ui'] }
    })
  }, [])

  const setUiField = useCallback((mode: ThemeMode, key: string, value: string) => {
    setDraft((d) => ({ ...d, ui: { ...d.ui, [mode]: { ...d.ui?.[mode], [key]: value } } as AppTheme['ui'] }))
  }, [])

  const revert = useCallback(() => setDraft(clone(source)), [source])

  const adoptPalette = useCallback((base: AppTheme) => {
    setDraft((d) => ({ ...clone(base), id: d.id, name: d.name }))
  }, [])

  return { draft, dirty, setName, setColor, setUiField, revert, adoptPalette }
}
