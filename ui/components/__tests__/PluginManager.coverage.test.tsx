/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../testUtils'
import PluginManager from '../PluginManager'

const quota: PluginDescriptor = {
  id: 'omniterm.agent-quota', name: 'Agent Quota', description: 'Quota lines', version: '1.0.0',
  permissions: ['renderer'], source: 'bundled', enabled: true, status: 'loaded',
}
const awake: PluginDescriptor = {
  ...quota, id: 'omniterm.always-awake', name: 'Always Awake', description: undefined, enabled: false, status: 'disabled',
}
const broken: PluginDescriptor = {
  ...quota, id: 'custom-plugin', name: 'Custom', source: 'user', status: 'error', error: 'broken',
}

function api(overrides: Record<string, unknown> = {}) {
  const plugin = {
    list: vi.fn(async () => [quota, awake, broken]),
    setEnabled: vi.fn(async () => ({})),
    ...overrides,
  }
  mockOmnitermAPI({ plugin })
  return plugin
}

function setup({ confirmations = [true], onlyPluginId }: { confirmations?: boolean[]; onlyPluginId?: string } = {}) {
  const answers = [...confirmations]
  const showConfirm = vi.fn(async () => answers.shift() ?? false)
  const showAlert = vi.fn(async () => {})
  const configure = vi.fn()
  render(
    <PluginManager
      showAlert={showAlert}
      showConfirm={showConfirm}
      configureAction={(id) => (id === quota.id ? configure : undefined)}
      onlyPluginId={onlyPluginId}
    />,
  )
  return { showAlert, showConfirm, configure }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PluginManager', () => {
  it('lists every built-in feature with its version, source and state', async () => {
    api()
    setup()
    expect(await screen.findByText('Agent Quota')).toBeTruthy()
    expect(screen.getByText('Always Awake')).toBeTruthy()
    expect(screen.getAllByText('Bundled')).toHaveLength(2)
    expect(screen.getByText('User')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
    expect(screen.getByText('broken')).toBeTruthy()
  })

  it('shows only the requested plugin in the details pane', async () => {
    api()
    setup({ onlyPluginId: awake.id })
    expect(await screen.findByText('Always Awake')).toBeTruthy()
    expect(screen.queryByText('Agent Quota')).toBeNull()
  })

  it('says so when nothing is listed', async () => {
    api({ list: vi.fn(async () => []) })
    setup()
    expect(await screen.findByText('No compatible plugins discovered.')).toBeTruthy()
  })

  it('offers Configure only for an enabled plugin with a settings page', async () => {
    api()
    const { configure } = setup()
    fireEvent.click(await screen.findByText('Configure'))
    expect(configure).toHaveBeenCalled()
    expect(screen.getAllByText('Configure')).toHaveLength(1)
  })

  it('switches a feature after confirmation and reloads the list', async () => {
    const plugin = api()
    const { showConfirm } = setup()
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable Always Awake' }))
    await waitFor(() => expect(plugin.setEnabled).toHaveBeenCalledWith(awake.id, true))
    expect(showConfirm).toHaveBeenCalledWith(expect.stringContaining('Enable “Always Awake”'), expect.objectContaining({ confirmLabel: 'Enable' }))
    expect(plugin.list).toHaveBeenCalledTimes(2)
  })

  it('leaves the feature alone when the confirmation is declined', async () => {
    const plugin = api()
    setup({ confirmations: [false] })
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable Agent Quota' }))
    await waitFor(() => expect(plugin.list).toHaveBeenCalledTimes(1))
    expect(plugin.setEnabled).not.toHaveBeenCalled()
  })

  it('reports a failed switch', async () => {
    api({ setEnabled: vi.fn(async () => { throw new Error('denied') }) })
    const { showAlert } = setup()
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable Agent Quota' }))
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Could not disable plugin: denied', expect.objectContaining({ tone: 'error' })))
  })

  it('reports a list that cannot be loaded', async () => {
    api({ list: vi.fn(async () => { throw 'offline' }) })
    const { showAlert } = setup()
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Could not load plugins: offline', expect.objectContaining({ tone: 'error' })))
  })
})
