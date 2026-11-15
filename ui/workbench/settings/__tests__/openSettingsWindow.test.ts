/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const executeAction = vi.fn(() => Promise.resolve(true))
const getAction = vi.fn()
const warn = vi.fn()

vi.mock('../../../ide/platform/actions', () => ({ executeAction, getAction }))
vi.mock('../../../diag', () => ({ diag: { warn, error: vi.fn() } }))

const { openSettingsWindow } = await import('../openSettingsWindow')
const { useSettingsWindowRedirect } = await import('../useSettingsWindowRedirect')
const { SETTINGS_TAB_EVENT } = await import('../../../../plugins/agent-quota/app/AgentQuotaRoot')
const { OMNITERM_SETTINGS_PAGES } = await import('../settingsPageIds')

const quotaTab = () => window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT, { detail: { tab: 'quota' } }))

beforeEach(() => {
  vi.useFakeTimers()
  getAction.mockReturnValue({ id: 'file.settings' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('openSettingsWindow', () => {
  it('runs file.settings with the page', () => {
    openSettingsWindow('tools.omnitermTerminal')
    vi.runAllTimers()
    expect(executeAction).toHaveBeenCalledWith('file.settings', 'tools.omnitermTerminal')
  })

  it('coalesces requests of one tick and keeps the named page', () => {
    openSettingsWindow()
    openSettingsWindow('tools.agentQuota')
    vi.runAllTimers()
    expect(executeAction).toHaveBeenCalledTimes(1)
    expect(executeAction).toHaveBeenCalledWith('file.settings', 'tools.agentQuota')
  })

  it('opens no separate window while the workbench action is not registered: it only reports it', () => {
    getAction.mockReturnValue(undefined)
    openSettingsWindow('plugins.node')
    vi.runAllTimers()
    expect(executeAction).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('useSettingsWindowRedirect', () => {
  it('maps the legacy Agent Quota tab event to its page, opening the dialog once', () => {
    renderHook(() => useSettingsWindowRedirect())
    quotaTab()
    vi.runAllTimers()
    expect(executeAction).toHaveBeenCalledTimes(1)
    expect(executeAction).toHaveBeenCalledWith('file.settings', OMNITERM_SETTINGS_PAGES.agentQuota)
  })

  it('stops listening on unmount', () => {
    const { unmount } = renderHook(() => useSettingsWindowRedirect())
    unmount()
    quotaTab()
    vi.runAllTimers()
    expect(executeAction).not.toHaveBeenCalled()
  })
})
