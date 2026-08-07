/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import DetachedTerminalWindow from '../DetachedTerminalWindow'

let terminalProps: any
vi.mock('../TerminalView', () => ({
  default: (props: any) => {
    terminalProps = props
    return <div data-testid="terminal">{props.id}:{props.mode}:{props.fontSize}:{props.theme?.background}</div>
  },
}))
vi.mock('../AppearanceMenu', () => ({
  default: (props: any) => <div data-testid="appearance">
    <button onClick={() => props.onFontSizeChange(1)}>font-up</button>
    <button onClick={() => props.onFontSizeChange(-100)}>font-min</button>
    <button onClick={() => props.onThemeApply('other')}>theme-other</button>
    <span>{props.themeId}:{props.fontSize}:{String(props.darkMode)}</span>
  </div>,
}))

const connection = {
  id: 'ssh-1', name: 'Server', type: 'SSH' as const, host: 'server.test', port: 22, username: 'dev',
}
const otherTheme = {
  ...TOKYO_NIGHT,
  id: 'other',
  name: 'Other',
  terminal: { ...TOKYO_NIGHT.terminal, dark: { ...TOKYO_NIGHT.terminal.dark, background: '#010203' } },
}
const baseSettings: AppSettings = {
  themeId: TOKYO_NIGHT.id, fontSize: 14, smartColors: true, checkUpdatesOnStartup: true,
  darkMode: true, zoomFactor: 1.25, perConn: { 'ssh-1': { fontSize: 18 } }, shortcuts: {} as ShortcutBindings,
}

beforeEach(() => {
  terminalProps = null
})

describe('DetachedTerminalWindow', () => {
  it('bootstraps, restores appearance, updates status, saves changes, and drives window chrome', async () => {
    const save = vi.fn(async () => {})
    const setAppSettings = vi.fn()
    const reattach = vi.fn(async () => true)
    const minimize = vi.fn(async () => {})
    const toggleMaximize = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    mockOmnitermAPI({
      terminalWindow: { bootstrap: vi.fn(async () => ({ sessionId: 'session-1', name: 'Server tab', connection })), reattach },
      settings: { save }, windowControl: { minimize, toggleMaximize, close },
    })

    render(<DetachedTerminalWindow appSettings={baseSettings} setAppSettings={setAppSettings}
      themes={[TOKYO_NIGHT, otherTheme]} smartColors />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('session-1:attach:18'))
    expect(screen.getByText('Server tab')).toBeInTheDocument()
    expect(terminalProps.connection).toEqual(connection)
    expect(terminalProps.smartColors).toBe(true)

    act(() => terminalProps.onExit(0))
    expect(close).toHaveBeenCalledOnce()

    act(() => terminalProps.onStatus('connected'))
    expect(screen.getByText('Connected')).toBeInTheDocument()
    act(() => terminalProps.onStatus('error'))
    expect(screen.getByText('Error')).toBeInTheDocument()
    act(() => terminalProps.onStatus('closed'))
    expect(screen.getByText('Closed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('font-up'))
    expect(setAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'ssh-1': expect.objectContaining({ fontSize: 19 }) }),
    }))
    fireEvent.click(screen.getByText('font-min'))
    expect(setAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'ssh-1': expect.objectContaining({ fontSize: 8 }) }),
    }))
    fireEvent.click(screen.getByText('theme-other'))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'ssh-1': expect.objectContaining({ themeId: 'other' }) }),
    }))
    act(() => terminalProps.onFontSizeChange(48))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      perConn: expect.objectContaining({ 'ssh-1': expect.objectContaining({ fontSize: 48 }) }),
    }))

    fireEvent.click(screen.getByText('Re-attach'))
    fireEvent.click(screen.getByTitle('Minimize'))
    fireEvent.click(screen.getByTitle('Maximize'))
    fireEvent.click(screen.getByTitle('Close'))
    expect(reattach).toHaveBeenCalledWith('session-1')
    expect(minimize).toHaveBeenCalled()
    expect(toggleMaximize).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('uses light theme and app defaults when the connection has no saved appearance', async () => {
    mockOmnitermAPI({ terminalWindow: { bootstrap: vi.fn(async () => ({ sessionId: 'local', name: 'Local', connection: { id: 'adhoc', name: 'Local', type: 'LOCAL', shell: 'cmd' } })) } })
    const settings = { ...baseSettings, darkMode: false, perConn: undefined, fontSize: 16 }
    render(<DetachedTerminalWindow appSettings={settings} setAppSettings={vi.fn()} themes={[TOKYO_NIGHT]} smartColors={false} />)
    await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('local:attach:16'))
    expect(terminalProps.theme).toEqual(TOKYO_NIGHT.terminal.light)
    expect(terminalProps.darkMode).toBe(false)
    expect(terminalProps.fontFamilyMono).toBe(TOKYO_NIGHT.ui.light.fontFamilyMono)
  })

  it('updates terminal theme when shared connection appearance changes', async () => {
    const settings = { ...baseSettings, perConn: undefined }
    mockOmnitermAPI({
      terminalWindow: { bootstrap: vi.fn(async () => ({ sessionId: 'session-1', name: 'Server tab', connection })) },
    })
    const { rerender } = render(
      <DetachedTerminalWindow appSettings={settings} setAppSettings={vi.fn()}
        themes={[TOKYO_NIGHT, otherTheme]} smartColors />,
    )
    await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('session-1:attach:14'))
    rerender(
      <DetachedTerminalWindow appSettings={{ ...settings, perConn: { 'ssh-1': { themeId: 'other' } } }} setAppSettings={vi.fn()}
        themes={[TOKYO_NIGHT, otherTheme]} smartColors />,
    )
    await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('session-1:attach:14'))
    expect(terminalProps.theme?.background).toBe('#010203')
  })

  it.each([
    ['empty bootstrap', async () => null],
    ['failed bootstrap', async () => { throw new Error('gone') }],
  ])('shows a missing-session message for %s', async (_label: string, bootstrap: () => Promise<unknown>) => {
    mockOmnitermAPI({ terminalWindow: { bootstrap } })
    render(<DetachedTerminalWindow appSettings={baseSettings} setAppSettings={vi.fn()} themes={[]} smartColors />)
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('This session is no longer available.')).toBeInTheDocument())
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
  })
})
