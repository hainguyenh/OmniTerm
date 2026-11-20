/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from '../../../ide/platform/project'
import { themeGroups, useContributedThemes } from '../../../ide/platform/themes'
import { useThemeOverride } from '../../../ide/workbench/theme'
import { TOKYO_NIGHT, type AppTheme } from '../../../themes'
import { omniChoiceId } from '../choice'
import { applyUnifiedTheme, installUnifiedTheme, setOmniThemes, useUnifiedTheme } from '../unifiedTheme'

vi.mock('../../../ide/platform/ipc', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => false,
}))

const OTHER: AppTheme = { ...JSON.parse(JSON.stringify(TOKYO_NIGHT)), id: 'other', name: 'Other' }

const select = (theme: string) =>
  useProject.setState({ settings: { appearance: { theme } } as never })

describe('applyUnifiedTheme', () => {
  let off: () => void
  beforeEach(() => {
    useThemeOverride.setState({ theme: null })
    off = installUnifiedTheme(() => 'dark')
    setOmniThemes([TOKYO_NIGHT, OTHER])
  })
  afterEach(() => {
    off()
    useProject.setState({ settings: null })
    document.getElementById('omniterm-theme-palette')?.remove()
    document.documentElement.removeAttribute('data-color-theme')
    document.documentElement.removeAttribute('data-omni-theme-kind')
  })

  it('offers every OmniTerm theme in both modes to the pickers', () => {
    const ids = useContributedThemes.getState().themes.map((t) => t.id)
    expect(ids).toContain(omniChoiceId('tokyo-night', 'dark'))
    expect(ids).toContain(omniChoiceId('other', 'light'))
  })

  it('paints an OmniTerm theme through the workbench palette and OmniTerm variables', () => {
    select(omniChoiceId('other', 'light'))
    const root = document.documentElement
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.colorTheme).toBe('omniterm')
    expect(document.getElementById('omniterm-theme-palette')?.textContent).toContain('--palette-bg')
    expect(root.style.getPropertyValue('--theme-bg')).toBe(OTHER.terminal.light.background)
    expect(useUnifiedTheme.getState()).toMatchObject({ themeId: 'other', mode: 'light' })
  })

  it('shows a workbench theme as Tokyo Night in its mode', () => {
    select(omniChoiceId('other', 'dark'))
    select('light')
    const root = document.documentElement
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.colorTheme).toBe('omniterm')
    expect(root.style.getPropertyValue('--theme-bg')).toBe(TOKYO_NIGHT.terminal.light.background)
    expect(useUnifiedTheme.getState()).toMatchObject({
      choice: omniChoiceId('tokyo-night', 'light'),
      themeId: 'tokyo-night',
      mode: 'light',
    })
  })

  it('offers no workbench theme: only the OmniTerm themes', () => {
    const offered = themeGroups().flatMap((group) => group.themes.map((t) => t.id))
    expect(offered).not.toContain('light')
    expect(offered).not.toContain('dark')
    expect(offered).not.toContain('solarized-dark')
    expect(offered).toContain(omniChoiceId('tokyo-night', 'dark'))
  })

  it('shows a retired workbench theme as Tokyo Night of its kind', () => {
    select('solarized-dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useUnifiedTheme.getState().choice).toBe(omniChoiceId('tokyo-night', 'dark'))
  })

  it('shows a deleted theme as Tokyo Night in its mode instead of failing', () => {
    select(omniChoiceId('gone', 'light'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(useUnifiedTheme.getState()).toMatchObject({ choice: omniChoiceId('tokyo-night', 'light'), themeId: 'tokyo-night' })
  })

  it('paints Tokyo Night before the theme list is read', () => {
    off()
    off = installUnifiedTheme(() => 'dark')
    select('dark')
    expect(useUnifiedTheme.getState().themeId).toBe('tokyo-night')
  })

  it('follows the copy kept in settings.json until the workbench settings are read', () => {
    useProject.setState({ settings: null })
    applyUnifiedTheme()
    expect(useUnifiedTheme.getState().mode).toBe('dark')
  })
})
