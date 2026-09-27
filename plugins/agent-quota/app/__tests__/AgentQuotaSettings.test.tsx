/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaConfig } from '../quotaConfig'

import AgentQuotaSettings from '../AgentQuotaSettings'
import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { getQuotaState, registerQuotaCommands, resetQuotaStore, setOverride, updateQuota } from '../quotaStore'

import { seed } from './quotaFixtures'

/** saveConfig that behaves like the real one: the store picks up what was saved. */
function liveSave() {
  const saveConfig = vi.fn((config: QuotaConfig) => updateQuota((state) => ({ ...state, config })))
  registerQuotaCommands({ saveConfig })
  return saveConfig
}

const claudeCard = () => within(screen.getByRole('region', { name: 'Claude Code quota settings' }))
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
const openGroup = (name: 'Agents' | 'Quota lines' | 'Loading artwork') => fireEvent.click(screen.getByRole('tab', { name }))

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

describe('AgentQuotaSettings', () => {
  it('edits land in a draft — nothing saves until Apply', () => {
    seed()
    const save = liveSave()
    render(<AgentQuotaSettings />)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Pin Agent Quota to the activity bar' }))
    expect(save).not.toHaveBeenCalled()
    expect(getQuotaState().config.pinned).toBe(true)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    apply()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: false }))
    expect(getQuotaState().config.pinned).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('Applied')
  })

  it('keeps agent loading art hidden until enabled and offers uploads per built-in slot only', () => {
    seed()
    const save = liveSave()
    render(<AgentQuotaSettings />)
    openGroup('Loading artwork')
    expect(screen.queryByRole('region', { name: 'Custom agent session artwork' })).toBeNull()
    expect(screen.getByText('off: plain running dots')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Show agent loading artwork' }))
    const panel = screen.getByRole('region', { name: 'Custom agent session artwork' })
    // Uploads live on each built-in slot; the separate "Custom artwork overrides" section is gone.
    expect(within(panel).queryByText('Custom artwork overrides')).toBeNull()
    expect(within(panel).queryByAltText('Light mode session artwork preview')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Upload Slow light mode artwork' })).toBeInTheDocument()
    expect(within(panel).getByAltText('Slow light mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('Slow dark mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('On-track light mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('On-track dark mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('Fast light mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('Fast dark mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('Critical light mode artwork')).toBeInTheDocument()
    expect(within(panel).getByAltText('Critical dark mode artwork')).toBeInTheDocument()
    expect(panel.querySelector('[data-art-mode="light"]')).toBeInTheDocument()
    expect(panel.querySelector('[data-art-mode="dark"]')).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Fast (1.6x)' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'large' }))

    apply()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      display: expect.objectContaining({ customArtSession: true, artSpeed: 'fast', artSize: 'large' }),
    }))
  })

  it('toggles the feature and hides the agent cards in the draft before Apply', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Agent Quota' }))
    expect(screen.queryByRole('region', { name: 'Claude Code quota settings' })).toBeNull()
    expect(getQuotaState().config.enabled).toBe(true) // not applied yet
    apply()
    expect(getQuotaState().config.enabled).toBe(false)
  })

  it('Reset discards the draft back to the committed config', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    fireEvent.change(claudeCard().getByLabelText('Claude Code Weekly limit'), { target: { value: '80' } })
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(claudeCard().getByLabelText('Claude Code Weekly limit')).toHaveValue('95')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('edits one agent: enable, limits, resume, delays and the hard stop', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    fireEvent.change(claudeCard().getByLabelText('Claude Code Weekly limit'), { target: { value: '80' } })
    fireEvent.click(claudeCard().getByRole('switch', { name: 'Resume Claude Code after the reset' }))
    fireEvent.change(claudeCard().getByLabelText('Resume delay (min)'), { target: { value: '500' } })
    fireEvent.change(claudeCard().getByLabelText('Watch after suspend (min)'), { target: { value: 'x' } })
    const hardStop = claudeCard().getByLabelText('Hard stop percentage')
    expect(hardStop).toBeDisabled()
    fireEvent.click(claudeCard().getByRole('checkbox'))
    fireEvent.change(hardStop, { target: { value: '97' } })
    apply()
    const claude = getQuotaState().config.agents.claude
    expect(claude).toMatchObject({ limits: { weekly: 80 }, autoResume: false, resumeDelayMinutes: 120, guardMinutes: 1, hardStopAtPct: 97 })
  })

  it('lets each agent replace the shared header icon', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    fireEvent.change(claudeCard().getByLabelText('Claude Code header icon mode'), { target: { value: 'emoji' } })
    fireEvent.change(claudeCard().getByLabelText('Claude Code custom header icon'), { target: { value: '🐙' } })
    apply()
    expect(getQuotaState().config.agents.claude.icon).toEqual({ mode: 'emoji', value: '🐙' })
  })

  it('requires confirmation to turn suspend off for an agent, applied only after Apply', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    const suspend = claudeCard().getByRole('switch', { name: 'Suspend Claude Code at its limit' })
    fireEvent.click(suspend)
    expect(getQuotaState().confirm?.title).toBeDefined()
    act(() => getQuotaState().confirm?.onConfirm())
    expect(getQuotaState().config.agents.claude.suspendAtLimit).toBe(true) // draft only
    apply()
    expect(getQuotaState().config.agents.claude.suspendAtLimit).toBe(false)
  })

  it('configures the wake schedule and refuses Apply for an unsafe prompt', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    const schedule = claudeCard().getByLabelText('Claude Code wake-up schedule')
    fireEvent.change(schedule, { target: { value: 'afterReset' } })
    fireEvent.change(claudeCard().getByLabelText('Minutes after the reset'), { target: { value: '7' } })
    fireEvent.change(claudeCard().getByLabelText('Prompt', { exact: false }), { target: { value: 'hi & bye' } })
    expect(claudeCard().getByText('Use letters, digits and simple punctuation only.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    fireEvent.change(claudeCard().getByLabelText('Prompt', { exact: false }), { target: { value: 'good morning' } })
    apply()
    expect(getQuotaState().config.agents.claude.wake).toMatchObject({ mode: 'afterReset', delayMinutes: 7, prompt: 'good morning' })
    expect(screen.queryByRole('region', { name: 'Antigravity quota settings' })).toBeNull()
  })

  it('offers to clear per-terminal overrides alongside Apply', () => {
    seed()
    liveSave()
    act(() => setOverride('s1:10:100', { limits: { session: 50 } }))
    render(<AgentQuotaSettings />)
    fireEvent.change(claudeCard().getByLabelText('Claude Code Session (5h) limit'), { target: { value: '85' } })
    expect(screen.getByText(/1 terminal with custom settings/)).toBeInTheDocument()
    apply()
    // Unchecked by default: existing per-terminal customizations are left alone.
    expect(getQuotaState().overrides).not.toEqual({})

    fireEvent.change(claudeCard().getByLabelText('Claude Code Session (5h) limit'), { target: { value: '86' } })
    fireEvent.click(screen.getByLabelText(/Also reset 1 terminal/))
    apply()
    expect(getQuotaState().overrides).toEqual({})
  })

  it('changes line size, lines, icons and animations with a live preview before Apply', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    openGroup('Quota lines')
    fireEvent.click(screen.getByRole('button', { name: 'thick' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Monthly' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reset countdown' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Quota warning animations' }))
    const preview = screen.getByLabelText('Preview')
    expect(preview).toHaveClass('aq-size-thick')
    expect(within(preview).getAllByTestId('aq-line-session').map((line) => line.getAttribute('data-zone')))
      .toEqual(['calm', 'watch', 'warm', 'hot', 'critical', 'over'])
    apply()
    const { display } = getQuotaState().config
    expect(display).toMatchObject({ size: 'thick', lines: { monthly: false }, icons: { resetCountdown: false }, animations: false })
    expect(DEFAULT_QUOTA_CONFIG.display.size).toBe('normal')
  })

  it('configures weekly auto-hide visibility threshold', () => {
    seed()
    const save = liveSave()
    render(<AgentQuotaSettings />)
    openGroup('Quota lines')
    const thresholdInput = screen.getByLabelText('Auto-hide weekly while usage is below this percentage')
    expect(thresholdInput).toHaveValue(60)
    fireEvent.change(thresholdInput, { target: { value: '75' } })
    apply()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      display: expect.objectContaining({ weeklyAutoHide: true, weeklyThresholdPct: 75 }),
    }))
  })

  it('allows uploading custom art for individual pace animations', async () => {
    seed()
    const uploadMock = vi.fn().mockResolvedValue('blob:custom-slow-light')
    const getMock = vi.fn().mockResolvedValue(null)
    const removeMock = vi.fn().mockResolvedValue(undefined)
    window.omnitermAPI = {
      ...(window.omnitermAPI ?? {}),
      customArt: {
        get: getMock,
        upload: uploadMock,
        remove: removeMock,
      },
    } as any

    render(<AgentQuotaSettings />)
    openGroup('Loading artwork')
    fireEvent.click(screen.getByRole('switch', { name: 'Show agent loading artwork' }))
    const uploadButton = screen.getByRole('button', { name: 'Upload Slow light mode artwork' })
    await act(async () => {
      fireEvent.click(uploadButton)
    })
    expect(uploadMock).toHaveBeenCalledWith('pace-slow-light')
  })

  it('shows one group at a time, starting with Agents', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Claude Code quota settings' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Preview')).toBeNull()

    openGroup('Quota lines')
    expect(screen.getByRole('tab', { name: 'Quota lines' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: 'Claude Code quota settings' })).toBeNull()
    expect(screen.getByLabelText('Preview')).toBeInTheDocument()

    openGroup('Loading artwork')
    expect(screen.queryByLabelText('Preview')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Show agent loading artwork' })).toBeInTheDocument()
  })

  it('summarises each agent on one line and expands it on demand', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    const codex = within(screen.getByRole('region', { name: 'Codex quota settings' }))
    expect(claudeCard().getByTestId('claude-summary')).toHaveTextContent('5h 90% · Weekly 95% · Monthly 95% · Suspend on · Wake off')
    // Claude starts expanded, Codex collapsed.
    expect(claudeCard().getByLabelText('Claude Code Weekly limit')).toBeInTheDocument()
    expect(claudeCard().getByLabelText('Claude Code limits preview')).toBeInTheDocument()
    expect(codex.queryByLabelText('Codex Weekly limit')).toBeNull()

    fireEvent.click(claudeCard().getByRole('button', { name: 'Hide Claude Code settings' }))
    expect(claudeCard().queryByLabelText('Claude Code Weekly limit')).toBeNull()
    fireEvent.click(claudeCard().getByRole('button', { name: 'Show Claude Code settings' }))
    fireEvent.change(claudeCard().getByLabelText('Claude Code Session (5h) limit'), { target: { value: '70' } })
    expect(claudeCard().getByTestId('claude-summary')).toHaveTextContent('5h 70%')
  })

  it('previews every artwork tier at the chosen size and speed', () => {
    seed()
    liveSave()
    render(<AgentQuotaSettings />)
    openGroup('Loading artwork')
    fireEvent.click(screen.getByRole('switch', { name: 'Show agent loading artwork' }))
    fireEvent.click(screen.getByRole('button', { name: 'large' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slow (0.6x)' }))
    const preview = screen.getByLabelText('Loading artwork preview')
    for (const tier of ['slow', 'onTrack', 'fast', 'overshooting']) {
      expect(within(preview).getByTestId(`art-preview-${tier}`)).toHaveClass(`aq-busy-art-${tier}`, 'aq-art-size-large', 'aq-art-speed-slow')
    }
    expect(screen.getByText('≤40% of limit')).toBeInTheDocument()
    expect(screen.getByText('>85%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(preview).toHaveAttribute('data-art-mode', 'light')
  })
})
