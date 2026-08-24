/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import MainLayoutOverlays from '../MainLayoutOverlays'
import type { MainLayoutModel } from '../useMainLayoutController'

// jsdom does not implement scrollIntoView; NewTerminalMenu scrolls the active row into view.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
})

vi.mock('../SettingsModal', () => ({
  default: (p: any) => p.isOpen ? (
    <div data-testid="settings-modal">
      <button onClick={p.onClose}>close-settings</button>
      <button onClick={() => p.setHasConnectionProvider(true)}>provider-on</button>
      <button onClick={p.refreshCustomArt}>refresh-art</button>
      <button onClick={p.checkForUpdates}>check-update</button>
      <button onClick={p.skipThisVersion}>skip-update</button>
      <button onClick={p.clearSkippedVersion}>clear-skip</button>
      <button onClick={p.handleDownloadPortable}>portable</button>
      <button onClick={p.handleDownloadInstaller}>installer</button>
      <button onClick={() => p.setRecordingAction(p.recordingAction ? null : 'zoomIn')}>
        {p.recordingAction ? 'Record…' : 'toggle-recording'}
      </button>
    </div>
  ) : null,
}))
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
    setSelectedWorkspaceId: vi.fn(),
    ...overrides,
  } as unknown as MainLayoutModel
}

beforeEach(() => {
  mockOmnitermAPI({ plugin: { connectionCapabilities: vi.fn(async () => ({ sftp: true })) } })
})

describe('MainLayoutOverlays', () => {
  it('covers settings modal integration and actions', async () => {
    const m = model({ aboutOpen: true })
    render(<MainLayoutOverlays model={m} />)
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('provider-on'))
    expect(m.setHasConnectionProvider).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByText('close-settings'))
    expect(m.setAboutOpen).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByText('refresh-art'))
    expect(m.refreshCustomArt).toHaveBeenCalled()
    for (const label of ['check-update', 'skip-update', 'clear-skip', 'portable', 'installer']) {
      fireEvent.click(screen.getByText(label))
    }
    expect(m.checkForUpdates).toHaveBeenCalled()
    expect(m.skipThisVersion).toHaveBeenCalled()
    expect(m.clearSkippedVersion).toHaveBeenCalled()
    expect(m.handleDownloadPortable).toHaveBeenCalled()
    expect(m.handleDownloadInstaller).toHaveBeenCalled()
    fireEvent.click(screen.getByText('toggle-recording'))
    expect(m.setRecordingAction).toHaveBeenCalledWith('zoomIn')
  })

  it('toggles a recording shortcut off', async () => {
    const m = model({ aboutOpen: true, recordingAction: 'zoomIn' })
    render(<MainLayoutOverlays model={m} />)
    expect(screen.getByText('Record…')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Record…'))
    expect(m.setRecordingAction).toHaveBeenCalledWith(null)
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
    const { rerender } = render(<MainLayoutOverlays model={first} />)
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
    fireEvent.contextMenu(screen.getByTestId('shell-menu-backdrop'))
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
  it('offers each composite workspace root as a quick-shell cwd', () => {
    const one = { id: 'one', name: 'One', folders: [{ id: 'f1', name: 'One', path: 'C:/one' }], order: 1, pins: [] }
    const multi = { id: 'multi', name: 'Multi', folders: [
      { id: 'f2', name: 'A', path: 'C:/a' }, { id: 'f3', name: 'B', path: 'D:/b' },
    ], order: 0, pins: [] }
    const shell = model({ shellMenu: { x: 5, y: 6 }, workspaces: [one, multi] })
    render(<MainLayoutOverlays model={shell} />)

    expect(screen.getByText('Multi - A')).toBeInTheDocument()
    expect(screen.getByText('Multi - B')).toBeInTheDocument()
    fireEvent.click(screen.getByText('One - One'))
    expect(shell.setSelectedWorkspaceId).toHaveBeenCalledWith('one::f1')
    expect(shell.setShellMenu).not.toHaveBeenCalled()
    expect(screen.getByRole('searchbox', { name: 'Search workspace or folder' })).toBeInTheDocument()
  })

  it('keeps the shell options menu inside the viewport near the bottom edge', () => {
    const shell = model({ shellMenu: { x: 900, y: 700 } })
    render(<MainLayoutOverlays model={shell} />)

    const menu = screen.getByTestId('new-terminal-menu')
    expect(menu).toHaveStyle({ bottom: '76px' })
    expect(menu.style.top).toBe('')
    expect(menu).toHaveClass('overflow-y-auto')
  })

})
