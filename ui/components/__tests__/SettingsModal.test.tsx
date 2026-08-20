/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsModal from '../SettingsModal'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'

const baseSettings: AppSettings = {
  themeId: TOKYO_NIGHT.id,
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
  shortcuts: {
    zoomIn: 'Ctrl+=',
    zoomOut: 'Ctrl+-',
    zoomReset: 'Ctrl+0',
    newSession: 'Ctrl+N',
    newFolder: 'Ctrl+Shift+N',
    openSettings: 'Ctrl+,',
    toggleThemeMode: 'Ctrl+/',
    layout1: 'Ctrl+1',
    layout2: 'Ctrl+2',
    layout3: 'Ctrl+3',
    layout4: 'Ctrl+4',
    layout5: 'Ctrl+5',
    layout6: 'Ctrl+6',
    layout7: 'Ctrl+7',
    layout8: 'Ctrl+8',
    toggleSidebar: 'Ctrl+B',
    commandPalette: 'CommandOrControl+P',
    closeTab: 'Ctrl+W',
  },
  excludedViewableExts: ['log'],
}

function renderModal(props: Partial<React.ComponentProps<typeof SettingsModal>> = {}) {
  const onClose = vi.fn()
  const setAppSettings = vi.fn()
  const setRecordingAction = vi.fn()
  const checkForUpdates = vi.fn()

  render(
    <SettingsModal
      isOpen={true}
      onClose={onClose}
      appSettings={baseSettings}
      setAppSettings={setAppSettings}
      shellOptions={[{ id: 'pwsh', label: 'PowerShell 7' }]}
      activeSessionCount={1}
      hasConnectionProvider={true}
      setHasConnectionProvider={vi.fn()}
      setConnectionCapabilities={vi.fn()}
      showAlert={vi.fn()}
      showConfirm={vi.fn().mockResolvedValue(true)}
      updateState={{ current: '1.0.0', latest: '1.0.0', updateAvailable: false } as unknown as UpdateState}
      updateChecking={false}
      installerChoiceOpen={false}
      setInstallerChoiceOpen={vi.fn()}
      checkForUpdates={checkForUpdates}
      skipThisVersion={vi.fn()}
      clearSkippedVersion={vi.fn()}
      handleDownloadPortable={vi.fn()}
      handleDownloadInstaller={vi.fn()}
      recordingAction={null}
      setRecordingAction={setRecordingAction}
      {...props}
    />,
  )

  return { onClose, setAppSettings, setRecordingAction, checkForUpdates }
}

beforeEach(() => {
  mockOmnitermAPI()
})

describe('SettingsModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SettingsModal
        isOpen={false}
        onClose={vi.fn()}
        appSettings={baseSettings}
        setAppSettings={vi.fn()}
        shellOptions={[]}
        activeSessionCount={0}
        hasConnectionProvider={false}
        setHasConnectionProvider={vi.fn()}
        setConnectionCapabilities={vi.fn()}
        showAlert={vi.fn()}
        showConfirm={vi.fn()}
        updateState={null}
        updateChecking={false}
        installerChoiceOpen={false}
        setInstallerChoiceOpen={vi.fn()}
        checkForUpdates={vi.fn()}
        skipThisVersion={vi.fn()}
        clearSkippedVersion={vi.fn()}
        handleDownloadPortable={vi.fn()}
        handleDownloadInstaller={vi.fn()}
        recordingAction={null}
        setRecordingAction={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders general tab by default and allows tab switching', () => {
    renderModal()
    expect(screen.getByText('General Preferences')).toBeInTheDocument()

    // Switch to Shortcuts
    fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()

    // Switch to Plugins
    fireEvent.click(screen.getByRole('button', { name: /plugins/i }))
    expect(screen.getByText('Install ZIP')).toBeInTheDocument()

    // Switch to Artwork
    fireEvent.click(screen.getByRole('button', { name: /artwork/i }))
    expect(screen.getByText('Custom Pane Art')).toBeInTheDocument()

    // Switch to About & Updates
    fireEvent.click(screen.getByRole('button', { name: /about & updates/i }))
    expect(screen.getByText('OmniTerm')).toBeInTheDocument()
    expect(screen.getByText('Check for updates')).toBeInTheDocument()
  })

  it('invokes onClose when clicking close button', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /close settings/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('allows recording a shortcut and resetting defaults in Shortcuts tab', () => {
    const { setRecordingAction, setAppSettings } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))

    // Click Edit on New Session shortcut
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    expect(editButtons.length).toBeGreaterThan(0)
    fireEvent.click(editButtons[0])
    expect(setRecordingAction).toHaveBeenCalled()

    // Click Reset
    fireEvent.click(screen.getByText('Reset'))
    expect(setAppSettings).toHaveBeenCalled()
  })
})
