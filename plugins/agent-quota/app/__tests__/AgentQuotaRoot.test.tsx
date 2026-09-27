/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentQuotaAPI } from '../agentQuotaAPI'

import { mockOmnitermAPI } from '../../../../ui/testUtils'
import { AgentQuotaRoot, QUICK_SETTINGS_EVENT, SETTINGS_TAB_EVENT } from '../AgentQuotaRoot'
import { getQuotaState, quotaCommands, resetQuotaStore } from '../quotaStore'

function fakeApi(present: boolean | (() => Promise<boolean>)): AgentQuotaAPI {
  return {
    info: vi.fn(typeof present === 'function' ? present : async () => present),
    detect: vi.fn(async () => []),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] })),
    resume: vi.fn(async () => 0),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 0),
    fetchUsage: vi.fn(async () => ({ windows: [], fetchedAt: 0 })),
    wake: vi.fn(async () => ({ ok: true })),
  }
}

const settings = { themeId: 't', fontSize: 12, smartColors: false, checkUpdatesOnStartup: false, darkMode: true } as AppSettings

beforeEach(() => {
  resetQuotaStore()
  mockOmnitermAPI()
})
afterEach(() => {
  resetQuotaStore()
  vi.useRealTimers()
})

describe('AgentQuotaRoot', () => {
  it('stays inert while the plugin is absent, retrying with back-off', async () => {
    vi.useFakeTimers()
    const api = fakeApi(false)
    const { container, unmount } = render(<AgentQuotaRoot api={api} appSettings={settings} setAppSettings={vi.fn()} sessionIds={[]} busy={{}} openSettings={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(api.info).toHaveBeenCalledTimes(5)
    expect(container).toBeEmptyDOMElement()
    expect(getQuotaState().available).toBe(false)
    window.dispatchEvent(new CustomEvent(QUICK_SETTINGS_EVENT))
    expect(getQuotaState().quickOpen).toBe(false)
    unmount()
  })

  it('runs the engine, saves settings, opens quick settings and the settings tab, and thaws on unmount', async () => {
    const api = fakeApi(true)
    const setAppSettings = vi.fn()
    const openSettings = vi.fn()
    const onTab = vi.fn()
    const save = vi.spyOn(window.omnitermAPI.settings, 'save')
    window.addEventListener(SETTINGS_TAB_EVENT, onTab)
    const { unmount, rerender } = render(
      <AgentQuotaRoot api={api} appSettings={{ ...settings, agentQuota: { pinned: false } }} setAppSettings={setAppSettings} sessionIds={['s1']} busy={{}} openSettings={openSettings} />,
    )
    await waitFor(() => expect(getQuotaState().available).toBe(true))
    expect(getQuotaState().config.pinned).toBe(false)
    await waitFor(() => expect(api.detect).toHaveBeenCalled())

    const next = { ...getQuotaState().config, pinned: true }
    quotaCommands().saveConfig(next)
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ agentQuota: next }))
    expect(save).toHaveBeenCalledWith({ agentQuota: next })

    act(() => window.dispatchEvent(new CustomEvent(QUICK_SETTINGS_EVENT)))
    expect(screen.getByRole('dialog', { name: 'Agent Quota quick settings' })).toBeInTheDocument()
    act(() => quotaCommands().openSettings())
    expect(openSettings).toHaveBeenCalled()
    expect(getQuotaState().quickOpen).toBe(false)
    expect((onTab.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'quota' })

    quotaCommands().refresh()
    quotaCommands().wake('all')
    quotaCommands().resume('s1')
    quotaCommands().resumeAll()
    rerender(<AgentQuotaRoot api={api} appSettings={settings} setAppSettings={setAppSettings} sessionIds={['s1', 's2']} busy={{ s1: true }} openSettings={openSettings} />)
    unmount()
    expect(api.resumeAll).toHaveBeenCalled()
    window.removeEventListener(SETTINGS_TAB_EVENT, onTab)
  })

  it('stops the engine and thaws frozen agents when the plugin is disabled, and recovers if it is re-enabled', async () => {
    vi.useFakeTimers()
    let present = true
    const api = fakeApi(() => Promise.resolve(present))
    render(<AgentQuotaRoot api={api} appSettings={settings} setAppSettings={vi.fn()} sessionIds={[]} busy={{}} openSettings={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(getQuotaState().available).toBe(true)

    // The Plugin Manager disabled it — no restart, no new mount, just the next periodic check.
    present = false
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getQuotaState().available).toBe(false)
    expect(api.resumeAll).toHaveBeenCalled()

    // Re-enabling brings it back without a restart either.
    present = true
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getQuotaState().available).toBe(true)
  })

  it('logs a failed resume-all on shutdown', async () => {
    const api = fakeApi(true)
    vi.mocked(api.resumeAll).mockRejectedValueOnce(new Error('ipc gone'))
    const { unmount } = render(<AgentQuotaRoot api={api} appSettings={settings} setAppSettings={vi.fn()} sessionIds={[]} busy={{}} openSettings={vi.fn()} />)
    await waitFor(() => expect(getQuotaState().available).toBe(true))
    unmount()
    await waitFor(() => expect(api.resumeAll).toHaveBeenCalled())
  })
})
