import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveConfig = vi.fn()
const show = vi.fn()
let config = { enabled: true, dock: 'footer', footer: true }

vi.mock('../../../features/agent-quota/quotaStore', () => ({
  getQuotaState: () => ({ config }),
  quotaCommands: () => ({ saveConfig }),
  useQuota: vi.fn(),
}))
vi.mock('../../../features/agent-quota/quotaDock', () => ({
  dockToolWindowSide: (dock: string) => (dock === 'left' || dock === 'right' ? dock : null),
}))
vi.mock('../../../ide/workbench/contributions', () => ({ toolWindowService: () => ({ show }) }))

import { closeQuotaPopup, effectiveDock, QUOTA_TOOL_WINDOW, setQuotaDock, toggleQuotaPopup, useQuotaPopup } from '../quotaDockState'

describe('effectiveDock', () => {
  it('shows the configured dock only while quota is available and enabled', () => {
    expect(effectiveDock({ available: true, config: { enabled: true, dock: 'footer' } })).toBe('footer')
    expect(effectiveDock({ available: false, config: { enabled: true, dock: 'footer' } })).toBe('hidden')
    expect(effectiveDock({ available: true, config: { enabled: false, dock: 'both' } })).toBe('hidden')
  })
})

describe('setQuotaDock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config = { enabled: true, dock: 'footer', footer: true }
    useQuotaPopup.setState({ open: true })
  })

  it('saves a new dock with the legacy footer flag and closes the popup when it leaves the footer', async () => {
    setQuotaDock('left')
    expect(saveConfig).toHaveBeenCalledWith({ enabled: true, dock: 'left', footer: false })
    expect(useQuotaPopup.getState().open).toBe(false)
    await Promise.resolve()
    expect(show).toHaveBeenCalledWith(QUOTA_TOOL_WINDOW, false)
  })

  it('keeps the footer flag for both; the same dock saves nothing and keeps the popup open on the footer', () => {
    setQuotaDock('both')
    expect(saveConfig).toHaveBeenCalledWith({ enabled: true, dock: 'both', footer: true })
    saveConfig.mockClear()
    useQuotaPopup.setState({ open: true })
    setQuotaDock('footer')
    expect(saveConfig).not.toHaveBeenCalled()
    expect(useQuotaPopup.getState().open).toBe(true)
    expect(show).not.toHaveBeenCalled()
  })

  it('toggles and closes the details popup', () => {
    useQuotaPopup.setState({ open: false })
    toggleQuotaPopup()
    expect(useQuotaPopup.getState().open).toBe(true)
    closeQuotaPopup()
    expect(useQuotaPopup.getState().open).toBe(false)
  })
})
