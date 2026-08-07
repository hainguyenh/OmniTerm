/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'

const captured = vi.hoisted(() => ({ title: null as any, main: null as any, remix: null as any, detached: null as any, shortcuts: null as any }))

vi.mock('../TitleBar', () => ({ TitleBar: (props: any) => {
  captured.title = props
  return <div data-testid="title"><button onClick={props.onSettingsOpen}>open-settings</button><button onClick={() => props.setThemeRemixOpen(true)}>open-remix</button><button onClick={props.onZoomReset}>reset-zoom</button><button onClick={() => props.onFontSizeChange(2)}>title-font</button><button onClick={() => props.onThemeApply('theme-b')}>title-theme</button><button onClick={() => props.onApplyToAll(22)}>all-font</button></div>
} }))
vi.mock('../MainLayout', () => ({ default: (props: any) => {
  captured.main = props
  return <div data-testid="main"><button onClick={() => props.onActiveTerminalChange({ id: 'tab-1', connId: 'conn-1' })}>focus-terminal</button><button onClick={() => props.onFontSizeChange(1)}>focused-font</button><button onClick={() => props.onFontSizeChange(-100, { id: 'adhoc-tab', connId: 'adhoc-new' })}>adhoc-font</button><button onClick={() => props.onThemeApply('theme-b')}>focused-theme</button><button onClick={() => props.onSettingsReload('tab-1')}>reload-settings</button></div>
} }))
vi.mock('../ThemeRemixModal', () => ({ ThemeRemixModal: (props: any) => {
  captured.remix = props
  return props.isOpen ? <div data-testid="remix"><button onClick={props.onClose}>close-remix</button><button onClick={() => props.setThemes([])}>clear-themes</button></div> : null
} }))
vi.mock('../DetachedTerminalWindow', () => ({ default: (props: any) => { captured.detached = props; return <div data-testid="detached-root" /> } }))
vi.mock('../../hooks/useAppShortcuts', () => ({ useAppShortcuts: (options: any) => { captured.shortcuts = options } }))

import App from '../../App'

const themeB = {
  ...TOKYO_NIGHT,
  id: 'theme-b',
  name: 'Theme B',
  terminal: {
    dark: { ...TOKYO_NIGHT.terminal.dark, background: '#010203', foreground: '#ffffff' },
    light: { ...TOKYO_NIGHT.terminal.light, background: '#fff', foreground: '#000' },
  },
}

let settingsChanged: (() => void) | null
let updateListener: ((state: UpdateState) => void) | null
let settingsSave: ReturnType<typeof vi.fn>
let settingsGet: ReturnType<typeof vi.fn>
let setZoomFactor: ReturnType<typeof vi.fn>

function install(settings: AppSettings, options: { detached?: boolean; themes?: any[] } = {}) {
  settingsChanged = null
  updateListener = null
  settingsSave = vi.fn(async () => {})
  settingsGet = vi.fn(async () => settings)
  setZoomFactor = vi.fn()
  mockOmnitermAPI({
    terminalWindow: { detachedSessionId: options.detached ? 'session-1' : null },
    settings: {
      get: settingsGet,
      save: settingsSave,
      onChanged: vi.fn((cb: () => void) => { settingsChanged = cb; return vi.fn() }),
    },
    themes: { list: vi.fn(async () => options.themes ?? [TOKYO_NIGHT, themeB]) },
    app: { setZoomFactor },
    updates: {
      onState: vi.fn((cb: (state: UpdateState) => void) => { updateListener = cb; return vi.fn() }),
      state: vi.fn(async () => ({ current: '1.0.0', checking: false })),
      getVersion: vi.fn(async () => '1.0.0'),
    },
  })
}

const settings: AppSettings = {
  themeId: TOKYO_NIGHT.id, fontSize: 14, smartColors: true, checkUpdatesOnStartup: true,
  darkMode: true, zoomFactor: 1.2, perConn: { 'conn-1': { fontSize: 16, themeId: TOKYO_NIGHT.id } },
  shortcuts: {} as ShortcutBindings,
}

beforeEach(() => {
  captured.title = captured.main = captured.remix = captured.detached = captured.shortcuts = null
  localStorage.clear()
})

describe('App orchestration', () => {
  it('loads state and drives global and focused appearance actions', async () => {
    install(settings)
    // TerminalView listens for this to force a re-measure — xterm's cached char size otherwise goes
    // stale on a WebView zoom change, since that changes CSS pixel density with no DOM resize event.
    const onZoomChanged = vi.fn()
    window.addEventListener('omniterm:zoom-changed', onZoomChanged)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('main')).toBeInTheDocument())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    expect(setZoomFactor).toHaveBeenCalledWith(1.2)
    expect(onZoomChanged).toHaveBeenCalled()
    window.removeEventListener('omniterm:zoom-changed', onZoomChanged)
    expect(captured.title.appVersion).toBe('1.0.0')
    expect(captured.main.currentTheme.id).toBe(TOKYO_NIGHT.id)

    fireEvent.click(screen.getByText('open-settings'))
    expect(captured.main.settingsOpen).toBe(true)
    fireEvent.click(screen.getByText('open-remix'))
    expect(screen.getByTestId('remix')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-remix'))
    expect(screen.queryByTestId('remix')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('reset-zoom'))
    expect(setZoomFactor).toHaveBeenCalledWith(1)
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({ zoomFactor: 1 }))

    fireEvent.click(screen.getByText('title-font'))
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 16 }))
    fireEvent.click(screen.getByText('title-theme'))
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-b' }))
    fireEvent.click(screen.getByText('all-font'))
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 22 }))

    fireEvent.click(screen.getByText('focus-terminal'))
    fireEvent.click(screen.getByText('focused-font'))
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'conn-1': expect.objectContaining({ fontSize: 17 }) }),
    }))
    fireEvent.click(screen.getByText('focused-theme'))
    expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'conn-1': expect.objectContaining({ themeId: 'theme-b' }) }),
    }))
    const savesBeforeAdhoc = settingsSave.mock.calls.length
    fireEvent.click(screen.getByText('adhoc-font'))
    expect(settingsSave).toHaveBeenCalledTimes(savesBeforeAdhoc)

    act(() => updateListener?.({ current: '1.0.0', checking: true } as UpdateState))
    expect(captured.title.updateState.checking).toBe(true)
    act(() => settingsChanged?.())
    await waitFor(() => expect(settingsGet.mock.calls.length).toBeGreaterThan(1))
    fireEvent.click(screen.getByText('reload-settings'))
    await waitFor(() => expect(settingsGet.mock.calls.length).toBeGreaterThan(2))
  })

  it('cleans stale ad-hoc appearance and exposes shortcut callbacks', async () => {
    install({ ...settings, perConn: { 'adhoc-old': { fontSize: 30 }, saved: { fontSize: 12 } } })
    render(<App />)
    await waitFor(() => expect(settingsSave).toHaveBeenCalledWith(expect.objectContaining({
      perConn: { saved: { fontSize: 12 } },
    })))

    act(() => captured.shortcuts.changeFontSize(-100))
    expect(settingsSave).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 8 }))
    act(() => captured.shortcuts.persistZoom(1.5))
    expect(settingsSave).toHaveBeenLastCalledWith(expect.objectContaining({ zoomFactor: 1.5 }))
    expect(captured.shortcuts.isDetached).toBe(false)
  })

  it('resets an in-memory terminal font override without persisting it', async () => {
    install(settings)
    render(<App />)
    await waitFor(() => expect(screen.getByText('focus-terminal')).toBeInTheDocument())
    fireEvent.click(screen.getByText('focus-terminal'))
    fireEvent.click(screen.getByText('focused-font'))
    const count = settingsSave.mock.calls.length
    act(() => captured.shortcuts.resetFontSize())
    expect(settingsSave).toHaveBeenCalledTimes(count)
    act(() => captured.shortcuts.resetFontSize())
    expect(settingsSave).toHaveBeenCalledTimes(count)
  })

  it('renders detached root and forwards settings and themes', async () => {
    install(settings, { detached: true })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('detached-root')).toBeInTheDocument())
    expect(screen.queryByTestId('main')).not.toBeInTheDocument()
    expect(captured.detached.smartColors).toBe(true)
    expect(captured.shortcuts.isDetached).toBe(true)
    act(() => captured.detached.setAppSettings({ ...settings, fontSize: 20 }))
    expect(captured.detached.appSettings.fontSize).toBe(20)
  })

  it('sets theme CSS for UI values and fallback light/dark palettes', async () => {
    install(settings, { themes: [TOKYO_NIGHT] })
    const { unmount } = render(<App />)
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(TOKYO_NIGHT.terminal.dark.background))
    expect(document.documentElement.style.getPropertyValue('--theme-font-family')).toBe(TOKYO_NIGHT.ui.dark.fontFamily)
    unmount()

    const fallback = {
      ...TOKYO_NIGHT, id: 'custom-novel', name: 'Fallback',
      terminal: { dark: { ...TOKYO_NIGHT.terminal.dark, background: '#fff' }, light: TOKYO_NIGHT.terminal.light },
      ui: { dark: undefined, light: undefined },
    } as any
    install({ ...settings, themeId: 'custom-novel' }, { themes: [fallback] })
    render(<App />)
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--theme-sidebar-bg')).toBe('rgba(0, 0, 0, 0.05)'))
    expect(document.documentElement.style.getPropertyValue('--theme-popup-bg')).toBe('#f2eed9')
  })
})
