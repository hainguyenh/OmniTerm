/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from '../../../ide/platform/project'
import { useThemeOverride } from '../../../ide/workbench/theme'
import { omniChoiceId } from '../choice'
import { useUnifiedTheme } from '../unifiedTheme'
import { useThemeSync } from '../useThemeSync'

const stored = (extra: Partial<AppSettings> = {}): AppSettings =>
  ({ themeId: 'claude', darkMode: true, fontSize: 14, smartColors: false, checkUpdatesOnStartup: false, ...extra }) as AppSettings

describe('useThemeSync', () => {
  beforeEach(() => {
    useThemeOverride.setState({ theme: null })
    useProject.setState({ settings: { appearance: { theme: 'light' } } as never })
    useUnifiedTheme.setState({ choice: 'light', mode: 'light' })
  })
  afterEach(() => {
    // Unmount first: this hook runs before RTL's own cleanup, and the reset would re-render it outside act.
    cleanup()
    useProject.setState({ settings: null })
  })

  it('carries an install that predates the workbench theme into the workbench setting once', async () => {
    const patch = vi.fn()
    renderHook(() => useThemeSync({ stored: stored(), loaded: true, enabled: true, patch }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ themeChoice: omniChoiceId('claude', 'dark') }))
    expect(useThemeOverride.getState().theme).toBe(omniChoiceId('claude', 'dark'))
  })

  it('syncs a choice made in the workbench into settings.json', () => {
    const patch = vi.fn()
    useUnifiedTheme.setState({ choice: omniChoiceId('claude', 'light'), mode: 'light' })
    renderHook(() => useThemeSync({ stored: stored({ themeChoice: 'dark' }), loaded: true, enabled: true, patch }))
    expect(patch).toHaveBeenCalledWith({ themeChoice: omniChoiceId('claude', 'light'), darkMode: false, themeId: 'claude' })
  })

  it('keeps the last OmniTerm theme when a workbench theme is chosen', () => {
    const patch = vi.fn()
    useUnifiedTheme.setState({ choice: 'solarized-dark', mode: 'dark' })
    renderHook(() => useThemeSync({ stored: stored({ themeChoice: 'dark', darkMode: false }), loaded: true, enabled: true, patch }))
    expect(patch).toHaveBeenCalledWith({ themeChoice: 'solarized-dark', darkMode: true })
  })

  it('does nothing in a window that only follows, or before settings are read', () => {
    const patch = vi.fn()
    renderHook(() => useThemeSync({ stored: stored(), loaded: true, enabled: false, patch }))
    renderHook(() => useThemeSync({ stored: stored(), loaded: false, enabled: true, patch }))
    expect(patch).not.toHaveBeenCalled()
  })

  it('writes nothing when the copy already matches', () => {
    const patch = vi.fn()
    renderHook(() => useThemeSync({ stored: stored({ themeChoice: 'light', darkMode: false }), loaded: true, enabled: true, patch }))
    expect(patch).not.toHaveBeenCalled()
  })
})
