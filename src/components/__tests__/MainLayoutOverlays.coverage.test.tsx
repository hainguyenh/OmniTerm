/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../../diag'
import { mockOmnitermAPI } from '../../testUtils'
import MainLayoutOverlays from '../MainLayoutOverlays'
import type { MainLayoutModel } from '../useMainLayoutController'

vi.mock('../PluginManager', () => ({ default: (p: any) => <div data-testid="plugins"><button onClick={() => p.onProviderStatusChanged(true)}>provider-on</button></div> }))
vi.mock('../GeneralSettings', () => ({ default: (p: any) => <button onClick={p.onCloseSettings}>close-settings</button> }))
vi.mock('../CustomArtSettings', () => ({ default: (p: any) => <button onClick={p.onArtChanged}>refresh-art</button> }))
vi.mock('../UpdateSettings', () => ({ default: (p: any) => <div data-testid="updates">
  <button onClick={p.checkForUpdates}>check-update</button><button onClick={p.skipThisVersion}>skip-update</button>
  <button onClick={p.clearSkippedVersion}>clear-skip</button><button onClick={p.handleDownloadPortable}>portable</button>
  <button onClick={p.handleDownloadInstaller}>installer</button><button onClick={() => p.setInstallerChoiceOpen(true)}>installer-choice</button>
</div> }))
vi.mock('../CloseConfirmModal', () => ({ default: (p: any) => <div data-testid="close-confirm">
  <button onClick={p.onCancel}>cancel-close</button><button onClick={() => p.onConfirm(false)}>confirm-one</button>
  <button onClick={() => p.onConfirm(true)}>confirm-all</button><span>{String(p.isMultiple)}</span>
</div> }))
vi.mock('../DialogHost', () => ({ default: (p: any) => <div data-testid="dialog-host">{String(Boolean(p.dialogState))}</div> }))
vi.mock('../CommandPalette', () => ({ CommandPalette: (p: any) => p.isOpen ? <div data-testid="palette"><button onClick={p.onClose}>close-palette</button><button onClick={() => p.onConnect(p.connections[0])}>palette-connect</button></div> : null }))

const connection = { id: 'ssh', name: 'Server', type: 'SSH', host: 'server', port: '22', user: 'me' }

function model(overrides: Record<string, unknown> = {}): MainLayoutModel {
  return {
    appSettings: { themeId: 'tokyo-night', fontSize: 14, smartColors: true, darkMode: true, shortcuts: {} },
    setAppSettings: vi.fn(), updateState: { current: '1.2.3' }, hasConnectionProvider: true,
    setHasConnectionProvider: vi.fn(), setConnectionCapabilities: vi.fn(), activeTabs: [
      { id: 'a', connId: 'ssh', name: 'A' }, { id: 'b', connId: 'ssh', name: 'B' }, { id: 'c', connId: 'ssh', name: 'C' },
    ], savedConnections: [connection], tabMenu: null, setTabMenu: vi.fn(), shellMenu: null, setShellMenu: vi.fn(),
    pendingCloseTabIds: null, setPendingCloseTabIds: vi.fn(), skipCloseConfirmRef: { current: false },
    recordingAction: null, setRecordingAction: vi.fn(), dialogState: null, showAlert: vi.fn(), showConfirm: vi.fn(),
    commandPaletteOpen: false, setCommandPaletteOpen: vi.fn(), aboutOpen: false, setAboutOpen: vi.fn(),
    updateChecking: false, installerChoiceOpen: false, setInstallerChoiceOpen: vi.fn(),
    shellOptions: [{ id: 'powershell', label: 'PowerShell' }, { id: 'cmd', label: 'Command Prompt' }],
    checkForUpdates: vi.fn(), handleDownloadPortable: vi.fn(), handleDownloadInstaller: vi.fn(),
    skipThisVersion: vi.fn(), clearSkippedVersion: vi.fn(), handleConnect: vi.fn(), requestNewSession: vi.fn(), closeTabs: vi.fn(), closeTab: vi.fn(),
    refreshCustomArt: vi.fn(), idleArtUrlLight: null, idleArtUrlDark: null, loadingArtUrlLight: null, loadingArtUrlDark: null,
    ...overrides,
  } as unknown as MainLayoutModel
}

beforeEach(() => {
  mockOmnitermAPI({ plugin: { connectionCapabilities: vi.fn(async () => ({ sftp: true })) } })
})

describe('MainLayoutOverlays', () => {
  it('covers settings, provider refresh, branding, shortcuts, and update actions', async () => {
    const m = model({ aboutOpen: true })
    const { container } = render(<MainLayoutOverlays model={m} />)
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText(/optional remote connections/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('provider-on'))
    await waitFor(() => expect(m.setConnectionCapabilities).toHaveBeenCalledWith({ sftp: true }))
    expect(m.setHasConnectionProvider).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByText('close-settings'))
    fireEvent.click(screen.getByText('refresh-art'))
    for (const label of ['check-update', 'skip-update', 'clear-skip', 'portable', 'installer', 'installer-choice']) fireEvent.click(screen.getByText(label))
    fireEvent.click(screen.getByText('Ctrl+='))
    expect(m.setRecordingAction).toHaveBeenCalledWith('zoomIn')
    fireEvent.click(container.querySelector('.flex.items-center.justify-between button') as HTMLButtonElement)
    expect(m.setAboutOpen).toHaveBeenCalledWith(false)
    fireEvent.click(container.firstElementChild as Element)
    expect(m.setAboutOpen).toHaveBeenCalledWith(false)
  })

  it('toggles a recording shortcut off and reports a provider capability error', async () => {
    const error = new Error('provider down')
    const errorSpy = vi.spyOn(diag, 'error').mockImplementation(() => {})
    mockOmnitermAPI({ plugin: { connectionCapabilities: vi.fn(async () => { throw error }) } })
    const m = model({ aboutOpen: true, recordingAction: 'zoomIn', hasConnectionProvider: false, updateState: null })
    render(<MainLayoutOverlays model={m} />)
    expect(screen.getByText('Record…')).toBeInTheDocument()
    expect(screen.getByText(/plugin-free local terminal/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Record…'))
    expect(m.setRecordingAction).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByText('provider-on'))
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(error))
  })

  it.each([
    ['Close', 'closeTab', ['b']],
    ['Close Others', 'closeTabs', [['a', 'c']]],
    ['Close to the Left', 'closeTabs', [['a']]],
    ['Close to the Right', 'closeTabs', [['c']]],
    ['Close All', 'closeTabs', [['a', 'b', 'c']]],
  ])('executes tab-menu action %s', (label: string, method: string, expected: unknown[]) => {
    const m = model({ tabMenu: { x: 10, y: 20, tabId: 'b' } }) as any
    render(<MainLayoutOverlays model={m} />)
    fireEvent.click(screen.getByText(label))
    expect(m[method]).toHaveBeenCalledWith(...expected)
    expect(m.setTabMenu).toHaveBeenCalledWith(null)
  })

  it('dismisses menus, ignores left/right actions at boundaries, and dispatches shell selection', () => {
    const first = model({ tabMenu: { x: 1, y: 2, tabId: 'a' } })
    const { rerender, container } = render(<MainLayoutOverlays model={first} />)
    fireEvent.click(screen.getByText('Close to the Left'))
    expect(first.closeTabs).not.toHaveBeenCalled()

    const last = model({ tabMenu: { x: 1, y: 2, tabId: 'c' } })
    rerender(<MainLayoutOverlays model={last} />)
    fireEvent.click(screen.getByText('Close to the Right'))
    expect(last.closeTabs).not.toHaveBeenCalled()

    const shell = model({ shellMenu: { x: 5, y: 6 } })
    rerender(<MainLayoutOverlays model={shell} />)
    fireEvent.click(screen.getByText('PowerShell'))
    expect(shell.requestNewSession).toHaveBeenCalledWith('powershell')
    expect(shell.setShellMenu).toHaveBeenCalledWith(null)

    const dismiss = model({ shellMenu: { x: 5, y: 6 } })
    rerender(<MainLayoutOverlays model={dismiss} />)
    fireEvent.contextMenu(container.firstElementChild as Element)
    expect(dismiss.setShellMenu).toHaveBeenCalledWith(null)
  })

  it('handles close confirmation and command palette actions', () => {
    const cancel = model({ pendingCloseTabIds: ['a', 'b'] })
    const { rerender } = render(<MainLayoutOverlays model={cancel} />)
    expect(screen.getByTestId('close-confirm')).toHaveTextContent('true')
    fireEvent.click(screen.getByText('cancel-close'))
    expect(cancel.setPendingCloseTabIds).toHaveBeenCalledWith(null)

    const confirm = model({ pendingCloseTabIds: ['a'] })
    rerender(<MainLayoutOverlays model={confirm} />)
    fireEvent.click(screen.getByText('confirm-one'))
    expect(confirm.closeTabs).toHaveBeenCalledWith(['a'], true)

    const all = model({ pendingCloseTabIds: ['a', 'b'] })
    rerender(<MainLayoutOverlays model={all} />)
    fireEvent.click(screen.getByText('confirm-all'))
    expect(all.skipCloseConfirmRef.current).toBe(true)

    const palette = model({ commandPaletteOpen: true })
    rerender(<MainLayoutOverlays model={palette} />)
    fireEvent.click(screen.getByText('palette-connect'))
    fireEvent.click(screen.getByText('close-palette'))
    expect(palette.handleConnect).toHaveBeenCalledWith(connection)
    expect(palette.setCommandPaletteOpen).toHaveBeenCalledWith(false)
  })
})
