import type { AppTheme } from '../../themes'

import { installUnifiedTheme, setOmniThemes } from './unifiedTheme'

/**
 * Theme for the IDE's auxiliary windows (Settings, comparison, Sync with Deployed), which load this
 * page without OmniTerm's shell: they offer OmniTerm's themes in their pickers and paint the
 * selected one, so a theme chosen in Settings > Appearance shows there and in every other window.
 */
export function installAuxTheme(): () => void {
  const api = window.omnitermAPI
  const off = installUnifiedTheme()
  void api?.themes
    .list()
    .then((themes: AppTheme[]) => setOmniThemes(themes))
    .catch(() => setOmniThemes([]))
  return off
}
