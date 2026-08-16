/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import { TitleBar } from '../TitleBar'

let appearance: any
vi.mock('../AppearanceMenu', () => ({
  default: (props: any) => {
    appearance = props
    return <div data-testid="appearance">
      <button onClick={() => props.onThemeApply('new-theme')}>theme</button>
      <button onClick={() => props.onFontSizeChange(1)}>font-up</button>
      <button onClick={() => props.onFontSizeChange(-1)}>font-down</button>
      <button onClick={props.onRemix}>remix</button>
    </div>
  },
}))

const settings: AppSettings = {
  themeId: TOKYO_NIGHT.id,
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
}

function renderBar(overrides: Record<string, unknown> = {}) {
  const props: any = {
    appSettings: settings,
    setAppSettings: vi.fn(),
    themes: [TOKYO_NIGHT],
    onSettingsOpen: vi.fn(),
    setThemeRemixOpen: vi.fn(),
    updateState: null,
    ...overrides,
  }
  return { ...render(<TitleBar {...props} />), props }
}

let emitMaximized: ((state: boolean) => void) | undefined
let cleanup: ReturnType<typeof vi.fn>
beforeEach(() => {
  cleanup = vi.fn()
  emitMaximized = undefined
  mockOmnitermAPI({
    settings: { save: vi.fn(async () => {}) },
    windowControl: {
      isMaximized: vi.fn(async () => false),
      onMaximizedState: vi.fn((fn: (value: boolean) => void) => { emitMaximized = fn; return cleanup }),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('TitleBar complete behavior', () => {
  it('loads and tracks maximize state, calls all window controls, and cleans up', async () => {
    const x = renderBar({ appVersion: '2.3.4', zoomFactor: 1.375, onZoomReset: vi.fn() })
    await waitFor(() => expect(window.omnitermAPI.windowControl.isMaximized).toHaveBeenCalled())
    expect(screen.getByText('- v2.3.4')).toBeInTheDocument()
    expect(screen.getByText('138%')).toBeInTheDocument()
    fireEvent.click(screen.getByText('138%'))
    expect(x.props.onZoomReset).toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Minimize'))
    fireEvent.click(screen.getByLabelText('Maximize'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(window.omnitermAPI.windowControl.minimize).toHaveBeenCalled()
    expect(window.omnitermAPI.windowControl.toggleMaximize).toHaveBeenCalled()
    expect(window.omnitermAPI.windowControl.close).toHaveBeenCalled()

    act(() => emitMaximized?.(true))
    expect(screen.getByLabelText('Restore Down')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Restore Down'))
    x.unmount()
    expect(cleanup).toHaveBeenCalled()
  })

  it('delegates global theme and font changes when host callbacks exist', () => {
    const onThemeApply = vi.fn()
    const onApplyToAll = vi.fn()
    const remix = vi.fn()
    renderBar({ onThemeApply, onApplyToAll, setThemeRemixOpen: remix })
    expect(appearance).toMatchObject({ themeId: TOKYO_NIGHT.id, fontSize: 14, darkMode: true, scopeLabel: 'all terminals' })
    fireEvent.click(screen.getByText('theme'))
    fireEvent.click(screen.getByText('font-up'))
    fireEvent.click(screen.getByText('font-down'))
    fireEvent.click(screen.getByText('remix'))
    expect(onThemeApply).toHaveBeenCalledWith('new-theme')
    expect(onApplyToAll).toHaveBeenNthCalledWith(1, 15)
    expect(onApplyToAll).toHaveBeenNthCalledWith(2, 13)
    expect(remix).toHaveBeenCalledWith(true)
  })

  it('uses detached-window font callback when apply-to-all is unavailable', () => {
    const onFontSizeChange = vi.fn()
    renderBar({ onFontSizeChange })
    fireEvent.click(screen.getByText('font-up'))
    expect(onFontSizeChange).toHaveBeenCalledWith(1)
    expect(window.omnitermAPI.settings.save).not.toHaveBeenCalled()
  })

  it('persists fallback theme and bounded font size when no host callback exists', () => {
    const setAppSettings = vi.fn()
    const save = vi.mocked(window.omnitermAPI.settings.save)
    const x = renderBar({ setAppSettings, appSettings: { ...settings, fontSize: 48 } })
    fireEvent.click(screen.getByText('theme'))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'new-theme' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'new-theme' }))
    fireEvent.click(screen.getByText('font-up'))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 48 }))
    x.unmount()

    const low = renderBar({ setAppSettings, appSettings: { ...settings, fontSize: 8 } })
    fireEvent.click(screen.getByText('font-down'))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 8 }))
    low.unmount()
  })

  it('toggles mode and handles default settings without optional chrome', async () => {
    const setAppSettings = vi.fn()
    renderBar({
      appSettings: { ...settings, darkMode: false, fontSize: undefined },
      setAppSettings,
      zoomFactor: undefined,
      appVersion: undefined,
    })
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^- v/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Switch to Dark Mode'))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ darkMode: true }))
    await waitFor(() => expect(window.omnitermAPI.settings.save).toHaveBeenCalledWith(expect.objectContaining({ darkMode: true })))
    expect(appearance.fontSize).toBe(14)
  })
})
