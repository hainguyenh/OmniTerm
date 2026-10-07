/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuotaActivityEntry } from '../activityEntry'
import { QuotaOverridePopover } from '../QuotaOverridePopover'
import { DangerConfirmDialog, QuotaNotices } from '../QuotaOverlays'
import { QuotaQuickPopover } from '../QuotaQuickPopover'
import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { getQuotaState, pushNotice, registerQuotaCommands, requestConfirm, resetQuotaStore, setOverride, setQuickOpen } from '../quotaStore'

import { NOW, profile, reading, seed, terminal } from './quotaFixtures'

beforeEach(() => resetQuotaStore())
afterEach(() => {
  resetQuotaStore()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('QuotaOverridePopover', () => {
  it('edits limits as a draft, applies as a sparse override, and resets to global', () => {
    seed()
    render(<QuotaOverridePopover terminal={terminal()} />)
    expect(screen.getByText('Using global settings')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Weekly limit for this terminal'), { target: { value: '70' } })
    // Nothing commits until Apply — a slider drag can't misfire a suspend/resume decision.
    expect(getQuotaState().overrides).toEqual({})
    expect(screen.getByText('Custom settings for this session')).toBeInTheDocument()
    const applyBtn = screen.getByRole('button', { name: 'Apply' })
    expect(applyBtn).toBeEnabled()
    fireEvent.click(applyBtn)
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ limits: { weekly: 70 } })
    expect(screen.getByRole('status')).toHaveTextContent('Applied')

    fireEvent.click(screen.getByRole('switch', { name: "Resume this terminal's agent after the reset" }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ limits: { weekly: 70 }, autoResume: false })

    fireEvent.click(screen.getByRole('button', { name: /Reset to global/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides).toEqual({})
  })

  it('Cancel discards the draft without touching the committed override', () => {
    seed()
    act(() => setOverride('s1:10:100', { limits: { weekly: 60 } }))
    render(<QuotaOverridePopover terminal={terminal()} />)
    fireEvent.change(screen.getByLabelText('Weekly limit for this terminal'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ limits: { weekly: 60 } })
    expect(getQuotaState().editing).toBeNull()
  })

  it('asks before turning suspend off in the draft, applied only on confirm', () => {
    seed()
    render(<QuotaOverridePopover terminal={terminal()} />)
    const suspend = screen.getByRole('switch', { name: "Suspend this terminal's agent at its limit" })
    fireEvent.click(suspend)
    expect(getQuotaState().confirm?.title).toBe('Turn off auto-suspend?')
    expect(getQuotaState().overrides).toEqual({})
    act(() => getQuotaState().confirm?.onConfirm())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ suspendAtLimit: false })
    fireEvent.click(suspend)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides).toEqual({})
  })

  it('configures a terminal wake schedule separately from the global settings, only once applied', () => {
    seed()
    render(<QuotaOverridePopover terminal={terminal()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Enable scheduled wake-up for this terminal' }))
    fireEvent.change(screen.getByLabelText('Terminal wake-up schedule'), { target: { value: 'timeOfDay' } })
    fireEvent.change(screen.getByLabelText('Terminal wake time'), { target: { value: '05:30' } })
    fireEvent.change(screen.getByLabelText('Terminal wake prompt'), { target: { value: 'check status' } })
    expect(getQuotaState().overrides).toEqual({})
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides['s1:10:100']).toMatchObject({
      wake: { mode: 'timeOfDay', time: '05:30', prompt: 'check status' },
    })
    expect(screen.getByText('Custom settings for this session')).toBeInTheDocument()
  })

  it('refuses to apply an unsafe wake prompt', () => {
    seed()
    render(<QuotaOverridePopover terminal={terminal()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Enable scheduled wake-up for this terminal' }))
    fireEvent.change(screen.getByLabelText('Terminal wake prompt'), { target: { value: 'hi & $(rm -rf ~)' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(getQuotaState().overrides).toEqual({})
  })

  it('offers resume while held, and Close discards the draft like Cancel', () => {
    const resume = vi.fn()
    seed({ profiles: [profile(undefined)], guards: { 's1:10:100': { phase: 'suspended', lastAttemptAt: NOW, risingCount: 0 } } })
    registerQuotaCommands({ resume })
    act(() => setOverride('s1:10:100', { limits: { session: 50 } }))
    render(<QuotaOverridePopover terminal={terminal()} />)
    expect(screen.getByLabelText('Session (5h) limit for this terminal')).toHaveValue('50')
    fireEvent.click(screen.getByRole('button', { name: /Resume now/ }))
    expect(getQuotaState().confirm?.title).toBe('Resume process now?')
    act(() => getQuotaState().confirm?.onConfirm())
    expect(resume).toHaveBeenCalledWith('s1')
    expect(getQuotaState().overrides['s1:10:100']).toMatchObject({ limits: { session: 50 }, suspendAtLimit: false })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(getQuotaState().editing).toBeNull()
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ enabled: false, limits: { session: 50 }, suspendAtLimit: false })
  })
})

describe('QuotaQuickPopover', () => {
  it('toggles the feature, agents and pin through saveConfig', () => {
    const saveConfig = vi.fn()
    seed()
    registerQuotaCommands({ saveConfig })
    render(<QuotaQuickPopover />)
    fireEvent.click(screen.getByRole('switch', { name: 'Agent Quota on' }))
    expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
    fireEvent.click(screen.getByRole('switch', { name: 'Monitor Codex' }))
    expect(saveConfig.mock.lastCall?.[0].agents.codex.enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Unpin from activity bar' }))
    expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: false }))
  })

  it('confirms before switching suspend off for every agent', () => {
    const saveConfig = vi.fn()
    seed()
    registerQuotaCommands({ saveConfig })
    render(<QuotaQuickPopover />)
    fireEvent.click(screen.getByRole('switch', { name: 'Suspend every agent at its limit' }))
    expect(saveConfig).not.toHaveBeenCalled()
    act(() => getQuotaState().confirm?.onConfirm())
    expect(Object.values(saveConfig.mock.lastCall?.[0].agents).every((agent) => !(agent as { suspendAtLimit: boolean }).suspendAtLimit)).toBe(true)
  })

  it('turns suspend back on without asking', () => {
    const saveConfig = vi.fn()
    const off = { ...DEFAULT_QUOTA_CONFIG, pinned: false, agents: { ...DEFAULT_QUOTA_CONFIG.agents, codex: { ...DEFAULT_QUOTA_CONFIG.agents.codex, suspendAtLimit: false } } }
    seed({ config: off })
    registerQuotaCommands({ saveConfig })
    render(<QuotaQuickPopover />)
    fireEvent.click(screen.getByRole('switch', { name: 'Suspend every agent at its limit' }))
    expect(saveConfig.mock.lastCall?.[0].agents.codex.suspendAtLimit).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pin to activity bar' }))
    expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true }))
  })

  it('allows global actions when agent terminals are open', () => {
    const commands = { wake: vi.fn(), resumeAll: vi.fn(), refresh: vi.fn(), openSettings: vi.fn() }
    seed({ profiles: [profile(reading(95))], guards: { 's1:10:100': { phase: 'suspended', lastAttemptAt: NOW, risingCount: 0 } } })
    registerQuotaCommands(commands)
    act(() => setQuickOpen(true))
    render(<QuotaQuickPopover />)
    fireEvent.click(screen.getByRole('button', { name: /Wake all open profiles/ }))
    fireEvent.click(screen.getByRole('button', { name: /Resume all/ }))
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    expect(commands.wake).toHaveBeenCalledWith('all')
    expect(commands.resumeAll).toHaveBeenCalled()
    expect(commands.refresh).toHaveBeenCalled()
    expect(commands.openSettings).toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'a' })
    expect(getQuotaState().quickOpen).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(getQuotaState().quickOpen).toBe(false)
  })

  it('disables wake when no agent runs, and closes from its button', () => {
    seed({ terminals: [], profiles: [] })
    act(() => setQuickOpen(true))
    render(<QuotaQuickPopover />)
    expect(screen.getByRole('button', { name: /Wake all open profiles/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(getQuotaState().quickOpen).toBe(false)
  })
})

describe('QuotaNotices and DangerConfirmDialog', () => {
  it('auto-dismisses info and warnings but keeps danger until dismissed', () => {
    vi.useFakeTimers()
    const { container } = render(<QuotaNotices />)
    expect(container).toBeEmptyDOMElement()
    act(() => {
      pushNotice('info', 'hello')
      pushNotice('warning', 'careful')
      pushNotice('danger', 'rising')
    })
    expect(screen.getAllByRole('status')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(8000) })
    expect(screen.queryByText('hello')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('rising')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(getQuotaState().notices).toEqual([])
  })

  it('confirms or cancels a dangerous change', () => {
    const onConfirm = vi.fn()
    const { container } = render(<DangerConfirmDialog />)
    expect(container).toBeEmptyDOMElement()
    act(() => requestConfirm({ title: 'Really?', message: 'Bad idea', confirmLabel: 'Do it', onConfirm }))
    expect(screen.getByRole('alertdialog', { name: 'Really?' })).toHaveTextContent('Bad idea')
    fireEvent.click(screen.getByRole('button', { name: 'Keep suspend on' }))
    expect(getQuotaState().confirm).toBeNull()
    act(() => requestConfirm({ title: 'Really?', message: 'Bad idea', confirmLabel: 'Do it', onConfirm }))
    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(getQuotaState().confirm).toBeNull()
    act(() => requestConfirm({ title: 'Really?', message: 'Bad idea', confirmLabel: 'Do it', onConfirm }))
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(getQuotaState().confirm).toBeNull()
  })
})

describe('useQuotaActivityEntry', () => {
  it('appears only when the plugin is present and pinned, and flags a held agent', () => {
    const { result, rerender } = renderHook(() => useQuotaActivityEntry())
    expect(result.current).toBeNull()
    act(() => seed())
    rerender()
    expect(result.current).toMatchObject({ label: 'Agent Quota: on · 1 profile', active: true, open: false, alert: false })
    act(() => result.current?.onClick())
    expect(getQuotaState().quickOpen).toBe(true)
    rerender()
    expect(result.current).toMatchObject({ open: true })
    act(() => seed({ guards: { k: { phase: 'guarding', lastAttemptAt: 0, risingCount: 0 } } }))
    rerender()
    expect(result.current).toMatchObject({ alert: true, label: 'Agent Quota: an agent is suspended' })
    act(() => seed({ config: { ...DEFAULT_QUOTA_CONFIG, enabled: false } }))
    rerender()
    expect(result.current).toMatchObject({ active: false, label: 'Agent Quota: off' })
    act(() => seed({ config: { ...DEFAULT_QUOTA_CONFIG, pinned: false } }))
    rerender()
    expect(result.current).toBeNull()
  })
})
