import { useMemo, useRef, useState } from 'react'

import { IconButton } from '../../ide/ui'
import { setTheme, useThemeChoices } from '../../ide/workbench/theme'
import { useUnifiedTheme } from '../../platform/theme/unifiedTheme'
import { diag } from '../../diag'

import { TitlePopupList } from './TitlePopupList'
import { themePopupEntries } from './themeEntries'

/** Title bar: a list of every theme (dark and light) to switch to in one click, next to the light / dark button. */
export function ThemePickerButton() {
  const choices = useThemeChoices()
  const current = useUnifiedTheme((s) => s.choice)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const entries = useMemo(
    () =>
      themePopupEntries(choices, current, (id) => {
        setTheme(id).catch((error: unknown) => diag.error('[theme] could not switch the theme', error))
      }),
    [choices, current],
  )
  return (
    <>
      <IconButton
        ref={ref}
        icon="palette"
        iconSize={16}
        title="Switch Theme"
        aria-label="Switch Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="title-theme-picker"
        style={{ width: 26, height: 26 }}
        onClick={() => setOpen((value) => !value)}
      />
      {open && <TitlePopupList anchor={ref} onClose={() => setOpen(false)} label="Themes" entries={entries} />}
    </>
  )
}
