import { parsePluginThemeRef, pluginThemeRef, type ThemeChoiceId } from '../../ide/platform/themes'

/**
 * OmniTerm's own themes live in the workbench's theme picker as contributed themes of a pseudo
 * plugin, one entry per appearance mode: the workbench's `appearance.theme` setting is a single
 * value that names a light or a dark theme, so "Tokyo Night" in dark mode and in light mode are two
 * choices (`plugin:omniterm/tokyo-night@dark`, `plugin:omniterm/tokyo-night@light`).
 */

export type ThemeMode = 'dark' | 'light'

/** The pseudo plugin OmniTerm's themes are contributed under. */
export const OMNI_PLUGIN_ID = 'omniterm'

/** Id of the OmniTerm theme derived from the workbench's own theme (Islands Light, Solarized, ...). */
export const WORKBENCH_THEME_ID = 'workbench'

/** Theme ids come from file names; the picker value is only ever built from ids that pass this. */
const THEME_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export const isSafeThemeId = (id: unknown): id is string => typeof id === 'string' && THEME_ID_RE.test(id)

export function omniChoiceId(themeId: string, mode: ThemeMode): ThemeChoiceId {
  return pluginThemeRef(OMNI_PLUGIN_ID, `${themeId}@${mode}`)
}

export interface OmniChoice {
  themeId: string
  mode: ThemeMode
}

/** The OmniTerm theme and mode a picker value names; `null` for the workbench's own themes. */
export function parseOmniChoice(choice: unknown): OmniChoice | null {
  const ref = parsePluginThemeRef(choice)
  if (!ref || ref.pluginId !== OMNI_PLUGIN_ID) return null
  const at = ref.themeId.lastIndexOf('@')
  if (at <= 0) return null
  const themeId = ref.themeId.slice(0, at)
  const mode = ref.themeId.slice(at + 1)
  return isSafeThemeId(themeId) && (mode === 'dark' || mode === 'light') ? { themeId, mode } : null
}

/** The picker value an install that only knows OmniTerm's `themeId` + `darkMode` settings starts from. */
export function legacyChoice(themeId: string | undefined, darkMode: boolean | undefined): ThemeChoiceId {
  const mode: ThemeMode = darkMode === false ? 'light' : 'dark'
  return isSafeThemeId(themeId) && themeId !== WORKBENCH_THEME_ID ? omniChoiceId(themeId, mode) : mode
}
