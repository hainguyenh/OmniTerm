/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import MainLayout from '../MainLayout'
import { TOKYO_NIGHT, type AppTheme } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'

const terminalState = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('../TerminalView', () => ({
  default: (props: Record<string, unknown>) => {
    terminalState.props = props
    return (
      <div
        data-testid="terminal-view"
        data-font-size={String(props.fontSize)}
        data-font-family={String(props.fontFamilyMono)}
      />
    )
  },
}))

const settings: AppSettings = {
  themeId: TOKYO_NIGHT.id,
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
  shortcuts: {
    zoomIn: 'Ctrl+=', zoomOut: 'Ctrl+-', zoomReset: 'Ctrl+0', newSession: 'Ctrl+N',
    newFolder: 'Ctrl+Shift+N', openSettings: 'Ctrl+,', toggleThemeMode: 'Ctrl+/',
    layout1: 'Ctrl+1', layout2: 'Ctrl+2', layout3: 'Ctrl+3', layout4: 'Ctrl+4',
    layout6: 'Ctrl+6', layout8: 'Ctrl+8', toggleSidebar: 'Ctrl+B',
    commandPalette: 'Ctrl+P', closeTab: 'Ctrl+W',
  },
}

const ALT_THEME: AppTheme = {
  ...TOKYO_NIGHT,
  id: 'test-alt',
  name: 'Test Alt',
  terminal: {
    dark: { ...TOKYO_NIGHT.terminal.dark, background: '#010203' },
    light: { ...TOKYO_NIGHT.terminal.light, background: '#fefefe' },
  },
  ui: {
    dark: { ...TOKYO_NIGHT.ui.dark, fontFamilyMono: 'Test Mono' },
    light: { ...TOKYO_NIGHT.ui.light, fontFamilyMono: 'Test Mono' },
  },
}

const SSH: Connection = {
  id: 'ssh-1',
  name: 'Production',
  type: 'SSH',
  host: 'server.example.com',
  port: '22',
  user: 'operator',
}

describe('MainLayout terminal appearance integration', () => {
  beforeEach(() => {
    terminalState.props = null
    localStorage.clear()
    globalThis.ResizeObserver = class {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    } as unknown as typeof ResizeObserver
  })

  it('targets the active session and preserves its appearance through the full layout', async () => {
    let openSession: ((connection: Connection) => void) | undefined
    let reattach: ((id: string) => void) | undefined
    const sshDisconnect = vi.fn()
    const onActiveTerminalChange = vi.fn()
    const onFontSizeChange = vi.fn()
    const onSettingsReload = vi.fn()
    const onZoomReset = vi.fn()

    mockOmnitermAPI({
      shells: {
        onOpen: (handler: (connection: Connection) => void) => {
          openSession = handler
          return () => undefined
        },
      },
      connect: { sshDisconnect },
      terminalWindow: {
        onReattached: (handler: (id: string) => void) => {
          reattach = handler
          return () => undefined
        },
      },
    })

    render(
      <MainLayout
        appSettings={settings}
        setAppSettings={vi.fn()}
        currentTheme={TOKYO_NIGHT}
        themes={[TOKYO_NIGHT, ALT_THEME]}
        layoutMode={1}
        setLayoutMode={vi.fn()}
        settingsOpen={false}
        setSettingsOpen={vi.fn()}
        updateState={null}
        setUpdateState={vi.fn()}
        zoomFactor={1.25}
        onZoomReset={onZoomReset}
        resolveAppearance={() => ({ themeId: ALT_THEME.id, fontSize: 18 })}
        onActiveTerminalChange={onActiveTerminalChange}
        onFontSizeChange={onFontSizeChange}
        onThemeApply={vi.fn()}
        onSettingsReload={onSettingsReload}
      />,
    )

    await waitFor(() => expect(openSession).toBeTypeOf('function'))
    act(() => openSession?.(SSH))

    const terminal = await screen.findByTestId('terminal-view')
    expect(terminal).toHaveAttribute('data-font-size', '18')
    expect(terminal).toHaveAttribute('data-font-family', 'Test Mono')
    await waitFor(() => expect(onActiveTerminalChange).toHaveBeenLastCalledWith({
      id: SSH.id,
      connId: SSH.id,
    }))

    expect(terminalState.props?.onFontSizeChange).toBeTypeOf('function')
    const terminalFontCallback = terminalState.props?.onFontSizeChange as (size: number) => void
    terminalFontCallback(20)
    expect(onFontSizeChange).toHaveBeenLastCalledWith(2, { id: SSH.id, connId: SSH.id })

    expect(screen.getByText('125%')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Reset zoom to 100%'))
    expect(onZoomReset).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByText('Disconnect'))
    expect(sshDisconnect).toHaveBeenCalledWith(SSH.id)

    act(() => reattach?.(SSH.id))
    expect(onSettingsReload).toHaveBeenCalledWith(SSH.id)
  })
})
