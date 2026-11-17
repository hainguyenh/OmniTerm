import { IconButton } from '../../ide/ui'
import { toggleThemeMode, useUnifiedTheme } from '../../platform/theme/unifiedTheme'
import { diag } from '../../diag'

/** Title bar: switches the whole app between its light and dark theme (also Ctrl+/). */
export function ThemeModeButton() {
  const dark = useUnifiedTheme((s) => s.mode === 'dark')
  const label = dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'
  return (
    <IconButton
      icon={dark ? 'sun' : 'moon'}
      iconSize={16}
      title={label}
      aria-label={label}
      data-testid="title-theme-mode"
      style={{ width: 26, height: 26 }}
      onClick={() => {
        toggleThemeMode().catch((error: unknown) => diag.error('[theme] could not switch the mode', error))
      }}
    />
  )
}
