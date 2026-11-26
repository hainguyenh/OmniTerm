import { useEffect } from 'react'

import { useProject } from '../../ide/platform/project'
import { setTheme } from '../../ide/workbench/theme'

import { legacyChoice, parseOmniChoice } from './choice'
import { useUnifiedTheme } from './unifiedTheme'

interface ThemeSyncInput {
  /** Settings as stored in settings.json (not the derived view). */
  stored: AppSettings
  /** The stored settings were read; before that `stored` is only the defaults. */
  loaded: boolean
  /** Only the main window writes the shared theme; popped-out windows follow it. */
  enabled: boolean
  patch: (partial: Partial<AppSettings>) => void
}

/**
 * Keeps settings.json's `themeChoice` / `themeId` / `darkMode` in step with the workbench setting,
 * which is the source of truth. The copy lets windows without the workbench backend (a popped-out
 * terminal) and the next start show the right theme before the workbench settings are read, and
 * keeps OmniTerm's older fields meaningful. An install that predates the workbench theme setting
 * has no `themeChoice`: its OmniTerm theme and mode are carried into the workbench setting once.
 */
export function useThemeSync({ stored, loaded, enabled, patch }: ThemeSyncInput): void {
  const appearance = useProject((s) => s.settings?.appearance)
  const choice = useUnifiedTheme((s) => s.choice)
  const mode = useUnifiedTheme((s) => s.mode)

  useEffect(() => {
    if (!enabled || !loaded || !appearance) return
    if (stored.themeChoice === undefined) {
      const carried = legacyChoice(stored.themeId, stored.darkMode)
      void setTheme(carried).then(() => patch({ themeChoice: carried }))
      return
    }
    if (stored.themeChoice === choice && stored.darkMode === (mode === 'dark')) return
    const omni = parseOmniChoice(choice)
    patch({ themeChoice: choice, darkMode: mode === 'dark', ...(omni ? { themeId: omni.themeId } : {}) })
  }, [enabled, loaded, appearance, stored.themeChoice, stored.themeId, stored.darkMode, choice, mode, patch])
}
