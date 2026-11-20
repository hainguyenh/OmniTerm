/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { ClaudeBridgeSettings } from '../ClaudeBridgeSettings'
import { bridgeLabel, bridgeRows, claudeBridge, parseClaudeBridgeStatus } from '../claudeBridgeAPI'

const status = (fields: Record<string, boolean> = {}) => ({ installed: false, current: false, wrapsStatusLine: false, unreadable: false, ...fields })

beforeEach(() => {
  invoke.mockReset()
})
afterEach(() => cleanup())

describe('claude bridge API', () => {
  it('validates the status and turns errors into a message', async () => {
    expect(parseClaudeBridgeStatus({ installed: true, current: 'yes' })).toEqual(status({ installed: true }))
    expect(parseClaudeBridgeStatus({ current: true })).toBeNull()
    expect(parseClaudeBridgeStatus(null)).toBeNull()
    invoke.mockResolvedValueOnce(status({ installed: true, current: true }))
    await expect(claudeBridge('install', 'C:/p')).resolves.toEqual({ ok: true, status: status({ installed: true, current: true }) })
    expect(invoke).toHaveBeenCalledWith('agent_quota_claude_bridge_install', { profileDir: 'C:/p' })
    invoke.mockRejectedValueOnce('settings.json is not valid JSON')
    await expect(claudeBridge('remove', 'C:/p')).resolves.toEqual({ ok: false, message: 'settings.json is not valid JSON' })
    invoke.mockResolvedValueOnce('nonsense')
    await expect(claudeBridge('status', 'C:/p')).resolves.toEqual({ ok: false, message: 'No answer.' })
    invoke.mockResolvedValueOnce(status())
    await claudeBridge('remove', 'C:/g', 'agy')
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_agy_bridge_remove', { profileDir: 'C:/g' })
  })
})

describe('ClaudeBridgeSettings', () => {
  it('lists Claude and Antigravity profiles with a folder once each', () => {
    expect(bridgeRows([
      { agent: 'claude', profileName: 'claude', profileDir: 'C:/u/.claude', launcher: null },
      { agent: 'claude', profileName: 'claude-th', profileDir: null, launcher: 'claude-th' },
      { agent: 'claude', profileName: 'dupe', profileDir: 'c:/U/.CLAUDE', launcher: null },
      { agent: 'codex', profileName: 'codex', profileDir: 'C:/u/.codex', launcher: null },
      { agent: 'agy', profileName: 'agy', profileDir: 'C:/u/.gemini', launcher: null },
    ])).toEqual([
      { agent: 'claude', name: 'claude', dir: 'C:/u/.claude' },
      { agent: 'agy', name: 'agy', dir: 'C:/u/.gemini' },
    ])
  })

  it('says what each state means', () => {
    expect(bridgeLabel(null)).toBe('Checking…')
    expect(bridgeLabel(status({ unreadable: true }))).toMatch(/not valid JSON/)
    expect(bridgeLabel(status())).toMatch(/Not installed: quota read with claude/)
    expect(bridgeLabel(status(), 'agy')).toMatch(/Not installed: quota read with agy/)
    expect(bridgeLabel(status({ installed: true }))).toMatch(/another OmniTerm copy/)
    expect(bridgeLabel(status({ installed: true, current: true }))).toBe('Installed')
    expect(bridgeLabel(status({ installed: true, current: true, wrapsStatusLine: true }))).toMatch(/earlier status line/)
  })

  it('installs into a profile and then offers to remove it', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'agent_quota_list_profiles') return Promise.resolve([{ agent: 'claude', profileName: 'claude', profileDir: 'C:/u/.claude', launcher: null }])
      if (command === 'agent_quota_claude_bridge_status') return Promise.resolve(status())
      if (command === 'agent_quota_claude_bridge_install') return Promise.resolve(status({ installed: true, current: true }))
      return Promise.reject(new Error(command))
    })
    render(<ClaudeBridgeSettings />)
    const row = within(await screen.findByTestId('claude-bridge-claude'))
    fireEvent.click(await row.findByRole('button', { name: 'Install' }))
    expect(await row.findByText('Installed')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(row.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('shows a failed action and keeps the last known state', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'agent_quota_list_profiles') return Promise.resolve([{ agent: 'claude', profileName: 'claude', profileDir: 'C:/u/.claude', launcher: null }])
      if (command === 'agent_quota_claude_bridge_status') return Promise.resolve(status({ installed: true, current: true }))
      return Promise.reject('locked')
    })
    render(<ClaudeBridgeSettings />)
    const row = within(await screen.findByTestId('claude-bridge-claude'))
    fireEvent.click(await row.findByRole('button', { name: 'Remove' }))
    expect(await row.findByText('locked')).toBeTruthy()
    expect(row.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('says when no profile folder is known', async () => {
    invoke.mockResolvedValue([])
    render(<ClaudeBridgeSettings />)
    expect(await screen.findByText('No Claude or Antigravity profile folder found.')).toBeTruthy()
  })

  it('runs the Antigravity commands on an Antigravity row', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'agent_quota_list_profiles') return Promise.resolve([{ agent: 'agy', profileName: 'agy', profileDir: 'C:/u/.gemini', launcher: null }])
      if (command === 'agent_quota_agy_bridge_status') return Promise.resolve(status())
      if (command === 'agent_quota_agy_bridge_install') return Promise.resolve(status({ installed: true, current: true }))
      return Promise.reject(new Error(command))
    })
    render(<ClaudeBridgeSettings />)
    const row = within(await screen.findByTestId('agy-bridge-agy'))
    expect(row.getByText('Antigravity')).toBeTruthy()
    fireEvent.click(await row.findByRole('button', { name: 'Install' }))
    expect(await row.findByText('Installed')).toBeTruthy()
  })
})
