/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { useProject } from '../../ide/platform/project'
import { mockOmnitermAPI } from '../../testUtils'
import UpdateSettings from '../../components/UpdateSettings'
import {
  getUpdateSource,
  migrateLegacyUpdateSource,
  saveUpdateSource,
  setUpdateSource,
} from '../updater'

const mockSettingsSet = vi.fn()

vi.mock('../../ide/platform/ipc', () => ({
  call: (promise: unknown) => promise,
  commands: {
    settingsSet: (scope: string, key: string, json: string) => mockSettingsSet(scope, key, json),
  },
  isTauri: () => true,
}))

const KEY = 'omniterm:update-source'

function withSource(updateSource?: string) {
  useProject.setState({ settings: { general: { updateSource }, appearance: {} } as never })
}

beforeEach(() => {
  localStorage.clear()
  mockSettingsSet.mockReset()
  mockSettingsSet.mockImplementation(async (_scope: string, _key: string, json: string) => ({
    general: { updateSource: JSON.parse(json) },
    appearance: {},
  }))
  withSource(undefined)
})

describe('update source setting', () => {
  it('reads general.updateSource through the shared logic', () => {
    withSource('cnb')
    expect(getUpdateSource()).toBe('cnb')
    withSource('github')
    expect(getUpdateSource()).toBe('github')
    withSource('auto')
    expect(getUpdateSource()).toBe('github')
  })

  it('takes a Settings change at once', async () => {
    withSource('github')
    useProject.setState({ settings: { general: { updateSource: 'cnb' }, appearance: {} } as never })
    expect(getUpdateSource()).toBe('cnb')
    setUpdateSource('github')
    await Promise.resolve()
    expect(mockSettingsSet).toHaveBeenCalledWith('global', 'general.updateSource', '"github"')
    expect(getUpdateSource()).toBe('github')
  })

  it('keeps the choice when writing the setting fails', async () => {
    mockSettingsSet.mockRejectedValue(new Error('disk'))
    await saveUpdateSource('cnb')
    expect(getUpdateSource()).toBe('cnb')
  })

  it('migrates a valid stored value once and drops the key', async () => {
    localStorage.setItem(KEY, 'cnb')
    await migrateLegacyUpdateSource()
    expect(mockSettingsSet).toHaveBeenCalledWith('global', 'general.updateSource', '"cnb"')
    expect(getUpdateSource()).toBe('cnb')
    expect(localStorage.getItem(KEY)).toBeNull()
    await migrateLegacyUpdateSource()
    expect(mockSettingsSet).toHaveBeenCalledTimes(1)
  })

  it('drops an invalid stored value without writing the setting', async () => {
    localStorage.setItem(KEY, 'invalid-source')
    await migrateLegacyUpdateSource()
    expect(mockSettingsSet).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('does not override an explicit setting with a stale stored value', async () => {
    withSource('github')
    localStorage.setItem(KEY, 'cnb')
    await migrateLegacyUpdateSource()
    expect(mockSettingsSet).not.toHaveBeenCalled()
    expect(getUpdateSource()).toBe('github')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('writes the setting from the selector in About & Updates', () => {
    mockOmnitermAPI({ settings: { save: vi.fn(async () => {}) } })
    withSource('github')
    render(
      <UpdateSettings
        appSettings={{} as never}
        setAppSettings={vi.fn()}
        updateState={null}
        updateChecking={false}
        installerChoiceOpen={false}
        setInstallerChoiceOpen={vi.fn()}
        checkForUpdates={vi.fn()}
        skipThisVersion={vi.fn()}
        clearSkippedVersion={vi.fn()}
        handleDownloadPortable={vi.fn()}
        handleDownloadInstaller={vi.fn()}
      />,
    )
    const select = screen.getByLabelText('Update source') as HTMLSelectElement
    expect(select.value).toBe('github')
    fireEvent.change(select, { target: { value: 'cnb' } })
    expect(mockSettingsSet).toHaveBeenCalledWith('global', 'general.updateSource', '"cnb"')
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
