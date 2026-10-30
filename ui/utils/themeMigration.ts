import type { AppTheme } from '../themes'
import { DEFAULT_THEME_ID } from '../themes'

const RETIRED_THEME_IDS = new Set(['compact', 'clickhouse', 'click-house', 'volt-agent'])

/** Keep legacy files untouched on disk; only omit the retired themes from the catalog. */
export function visibleThemes<T extends Pick<AppTheme, 'id'>>(themes: readonly T[]): T[] {
  return themes.filter(theme => !RETIRED_THEME_IDS.has(theme.id))
}

export type ThemeSelectionSettings = {
  themeId: string
  perConn?: Record<string, { themeId?: string; fontSize?: number }>
}

/** Migrate selections from retired built-ins without deleting user-authored theme files. */
export const migrateThemeSettings = <T extends ThemeSelectionSettings>(
  settings: T,
  themes: readonly Pick<AppTheme, 'id'>[],
): T => {
  const available = new Set(themes.map(theme => theme.id))
  const mapId = (id: string): string => {
    // Retired built-ins are never selectable, even if a saved override still exists on disk.
    if (['compact', 'clickhouse', 'click-house'].includes(id) && available.has('terminal-paper')) return 'terminal-paper'
    if (id === 'volt-agent' && available.has(DEFAULT_THEME_ID)) return DEFAULT_THEME_ID
    if (available.has(id)) return id
    return id
  }

  const themeId = mapId(settings.themeId)
  let perConn = settings.perConn
  for (const [id, appearance] of Object.entries(settings.perConn ?? {})) {
    if (!appearance?.themeId) continue
    const migrated = mapId(appearance.themeId)
    if (migrated === appearance.themeId) continue
    perConn = { ...perConn, [id]: { ...appearance, themeId: migrated } }
  }

  if (themeId === settings.themeId && perConn === settings.perConn) return settings
  return { ...settings, themeId, perConn }
}
