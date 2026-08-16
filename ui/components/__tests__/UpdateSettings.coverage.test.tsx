/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import UpdateSettings from '../UpdateSettings'

const baseSettings: AppSettings = {
  themeId: 'tokyo-night', fontSize: 14, smartColors: true, checkUpdatesOnStartup: false, darkMode: true,
}
const state = (patch: Partial<UpdateState> = {}): UpdateState => ({
  current: '1.0.0', latest: null, latestTag: null, latestName: '', notes: '', htmlUrl: '',
  publishedAt: null, updateAvailable: false, skippedVersion: null, lastCheckAt: null,
  error: null, checking: false, isPortable: false, portableAssetUrl: null, installerAssetUrl: null,
  downloadProgress: null, downloadStatus: null, hasNewerVersion: false, ...patch,
})

function props(overrides: Record<string, unknown> = {}) {
  return {
    appSettings: baseSettings, setAppSettings: vi.fn(), updateState: null, updateChecking: false,
    installerChoiceOpen: false, setInstallerChoiceOpen: vi.fn(), checkForUpdates: vi.fn(),
    skipThisVersion: vi.fn(), clearSkippedVersion: vi.fn(), handleDownloadPortable: vi.fn(),
    handleDownloadInstaller: vi.fn(), ...overrides,
  }
}

beforeEach(() => mockOmnitermAPI({ settings: { save: vi.fn(async () => {}) } }))

describe('UpdateSettings', () => {
  it('shows unchecked and checking states and toggles startup checks', () => {
    const p = props()
    const { rerender } = render(<UpdateSettings {...p} />)
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Check for updates'))
    expect(p.checkForUpdates).toHaveBeenCalled()
    fireEvent.click(screen.getByText('OFF'))
    expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ checkUpdatesOnStartup: true }))
    expect(window.omnitermAPI.settings.save).toHaveBeenCalled()

    rerender(<UpdateSettings {...props({ updateChecking: true, appSettings: { ...baseSettings, checkUpdatesOnStartup: true } })} />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()
    expect(screen.getByText('Check for updates').closest('button')).toBeDisabled()
  })

  it('shows current, last-check, newer-version, and skipped-version states', () => {
    const p = props({ updateState: state({ latest: '1.0.0', lastCheckAt: Date.UTC(2026, 0, 2, 3, 4, 5), hasNewerVersion: true, skippedVersion: '1.1.0' }) })
    render(<UpdateSettings {...p} />)
    expect(screen.getByText(/Up to date/)).toBeInTheDocument()
    expect(screen.getByText(/Last checked/)).toBeInTheDocument()
    expect(screen.getByText('Skipping v1.1.0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Clear skipped version/ }))
    expect(p.clearSkippedVersion).toHaveBeenCalled()
  })

  it('retries errors and shows a newer-version badge', () => {
    const p = props({ updateState: state({ error: 'network failed', hasNewerVersion: true }) })
    render(<UpdateSettings {...p} />)
    expect(screen.getByText(/network failed/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry'))
    expect(p.checkForUpdates).toHaveBeenCalled()
  })

  it('downloads portable updates and skips versions', () => {
    const p = props({ updateState: state({ updateAvailable: true, latest: '2.0.0', isPortable: true, downloadStatus: 'Downloading 50%' }) })
    render(<UpdateSettings {...p} />)
    expect(screen.getByText('Update available — v2.0.0')).toBeInTheDocument()
    expect(screen.getByText('Downloading 50%')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Download update'))
    fireEvent.click(screen.getByText('Skip v2.0.0'))
    expect(p.handleDownloadPortable).toHaveBeenCalled()
    expect(p.skipThisVersion).toHaveBeenCalled()
  })

  it('opens installer choices and runs immediate or on-exit install', () => {
    const closed = props({ updateState: state({ updateAvailable: true, latest: '2.0.0', isPortable: false }) })
    const { rerender } = render(<UpdateSettings {...closed} />)
    fireEvent.click(screen.getByText('Install update'))
    expect(closed.setInstallerChoiceOpen).toHaveBeenCalledWith(true)

    const open = props({ updateState: state({ updateAvailable: true, latest: '2.0.0' }), installerChoiceOpen: true })
    rerender(<UpdateSettings {...open} />)
    fireEvent.click(screen.getByText('Install now'))
    fireEvent.click(screen.getByText('On exit'))
    expect(open.handleDownloadInstaller).toHaveBeenNthCalledWith(1, true)
    expect(open.handleDownloadInstaller).toHaveBeenNthCalledWith(2, false)
  })
})
