/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import SettingsModal from '../SettingsModal'
import { SETTINGS_TAB_EVENT } from '../../../plugins/agent-quota/app/AgentQuotaRoot'
import { getQuotaState, resetQuotaStore, updateQuota } from '../../../plugins/agent-quota/app/quotaStore'
import { mockOmnitermAPI } from '../../testUtils'

const settings = { themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true } as AppSettings

function renderModal() {
  return render(
    <SettingsModal
      isOpen onClose={vi.fn()} appSettings={settings} setAppSettings={vi.fn()} shellOptions={[]}
      activeSessionCount={0} hasConnectionProvider={false} setHasConnectionProvider={vi.fn()}
      setConnectionCapabilities={vi.fn()} showAlert={vi.fn()} showConfirm={vi.fn()} updateState={null}
      updateChecking={false} installerChoiceOpen={false} setInstallerChoiceOpen={vi.fn()}
      checkForUpdates={vi.fn()} skipThisVersion={vi.fn()} clearSkippedVersion={vi.fn()}
      handleDownloadPortable={vi.fn()} handleDownloadInstaller={vi.fn()} recordingAction={null}
      setRecordingAction={vi.fn()}
    />,
  )
}

const makeAvailable = () => act(() => updateQuota((state) => ({ ...state, available: true })))

beforeEach(() => {
  resetQuotaStore()
  mockOmnitermAPI()
})
afterEach(() => resetQuotaStore())

describe('Agent Quota in the host UI', () => {
  it('hides the settings tab until the plugin answers', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /Agent Quota/ })).toBeNull()
    makeAvailable()
    fireEvent.click(screen.getByRole('button', { name: /Agent Quota/ }))
    expect(screen.getByRole('switch', { name: 'Enable Agent Quota' })).toBeInTheDocument()
  })

  it('switches to the requested tab by event and ignores unknown tabs', () => {
    makeAvailable()
    renderModal()
    act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT, { detail: { tab: 'nope' } })) })
    expect(screen.queryByRole('switch', { name: 'Enable Agent Quota' })).toBeNull()
    act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT, { detail: { tab: 'quota' } })) })
    expect(screen.getByRole('switch', { name: 'Enable Agent Quota' })).toBeInTheDocument()
    act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT)) })
    expect(screen.getByRole('switch', { name: 'Enable Agent Quota' })).toBeInTheDocument()
  })

  it('shows the pinned activity-bar icon, with an alert dot while an agent is frozen', () => {
    render(<ActivityBar activeView={null} filesEnabled={false} onViewChange={vi.fn()} onSettingsClick={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Agent Quota/ })).toBeNull()
    makeAvailable()
    fireEvent.click(screen.getByRole('button', { name: 'Agent Quota: on' }))
    expect(getQuotaState().quickOpen).toBe(true)
    act(() => updateQuota((state) => ({ ...state, guards: { k: { phase: 'suspended', lastAttemptAt: 0, risingCount: 0 } } })))
    expect(screen.getByRole('button', { name: 'Agent Quota: an agent is suspended' }).querySelector('.rounded-full')).not.toBeNull()
  })
})
