/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateActions } from '../useUpdateActions'

const updates = {
  check: vi.fn(),
  showSaveDialog: vi.fn(),
  downloadPortable: vi.fn(),
  downloadInstaller: vi.fn(),
  skip: vi.fn(),
}

function setup(latest: string | null = '1.2.3') {
  const setUpdateState = vi.fn()
  const showAlert = vi.fn().mockResolvedValue(undefined)
  const state = (latest ? { latest } : null) as UpdateState | null
  const hook = renderHook(() => useUpdateActions({ updateState: state, setUpdateState, showAlert }))
  return { hook, setUpdateState, showAlert }
}

describe('useUpdateActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'omnitermAPI', { value: { updates }, configurable: true, writable: true })
  })

  it('stores the result of a check and clears the busy flag', async () => {
    updates.check.mockResolvedValue({ latest: '2.0.0' })
    const { hook, setUpdateState } = setup()
    await act(async () => { await hook.result.current.checkForUpdates() })
    expect(setUpdateState).toHaveBeenCalledWith({ latest: '2.0.0' })
    expect(hook.result.current.updateChecking).toBe(false)
  })

  it('reports a failed check with the error message', async () => {
    updates.check.mockRejectedValue(new Error('offline'))
    const { hook, showAlert } = setup()
    await act(async () => { await hook.result.current.checkForUpdates() })
    expect(showAlert).toHaveBeenCalledWith('Could not check for updates: offline', { title: 'Update Check Failed', tone: 'error' })
    expect(hook.result.current.updateChecking).toBe(false)
  })

  it('stringifies a non-Error rejection', async () => {
    updates.check.mockRejectedValue('boom')
    const { hook, showAlert } = setup()
    await act(async () => { await hook.result.current.checkForUpdates() })
    expect(showAlert.mock.calls[0]?.[0]).toBe('Could not check for updates: boom')
  })

  it('downloads the portable build to the chosen path', async () => {
    updates.showSaveDialog.mockResolvedValue('C:/out.exe')
    updates.downloadPortable.mockResolvedValue(undefined)
    const { hook } = setup()
    await act(async () => { await hook.result.current.handleDownloadPortable() })
    expect(updates.showSaveDialog).toHaveBeenCalledWith('OmniTerm-Portable-1.2.3.exe')
    expect(updates.downloadPortable).toHaveBeenCalledWith('C:/out.exe')
  })

  it('does nothing without a latest version or a chosen path', async () => {
    const none = setup(null)
    await act(async () => { await none.hook.result.current.handleDownloadPortable() })
    expect(updates.showSaveDialog).not.toHaveBeenCalled()
    updates.showSaveDialog.mockResolvedValue(null)
    const cancelled = setup()
    await act(async () => { await cancelled.hook.result.current.handleDownloadPortable() })
    expect(updates.downloadPortable).not.toHaveBeenCalled()
  })

  it('alerts when the portable download fails', async () => {
    updates.showSaveDialog.mockResolvedValue('C:/out.exe')
    updates.downloadPortable.mockRejectedValue(new Error('disk full'))
    const { hook, showAlert } = setup()
    await act(async () => { await hook.result.current.handleDownloadPortable() })
    expect(showAlert).toHaveBeenCalledWith('Download failed: disk full', { title: 'Download Error', tone: 'error' })
    expect(hook.result.current.updateChecking).toBe(false)
  })

  it('downloads the installer and closes the choice dialog', async () => {
    updates.downloadInstaller.mockResolvedValue(undefined)
    const { hook } = setup()
    act(() => hook.result.current.setInstallerChoiceOpen(true))
    await act(async () => { await hook.result.current.handleDownloadInstaller(true) })
    expect(updates.downloadInstaller).toHaveBeenCalledWith(true)
    expect(hook.result.current.installerChoiceOpen).toBe(false)
  })

  it('alerts when the installer download fails', async () => {
    updates.downloadInstaller.mockRejectedValue(new Error('403'))
    const { hook, showAlert } = setup()
    await act(async () => { await hook.result.current.handleDownloadInstaller(false) })
    expect(showAlert).toHaveBeenCalledWith('Download failed: 403', { title: 'Download Error', tone: 'error' })
  })

  it('skips the latest version and clears the skip', async () => {
    updates.skip.mockResolvedValue({ latest: '1.2.3', skipped: '1.2.3' })
    const { hook, setUpdateState } = setup()
    await act(async () => { await hook.result.current.skipThisVersion() })
    expect(updates.skip).toHaveBeenCalledWith('1.2.3')
    await act(async () => { await hook.result.current.clearSkippedVersion() })
    expect(updates.skip).toHaveBeenLastCalledWith(null)
    expect(setUpdateState).toHaveBeenCalledTimes(2)
  })

  it('has nothing to skip without a latest version', async () => {
    const { hook } = setup(null)
    await act(async () => { await hook.result.current.skipThisVersion() })
    expect(updates.skip).not.toHaveBeenCalled()
  })
})
