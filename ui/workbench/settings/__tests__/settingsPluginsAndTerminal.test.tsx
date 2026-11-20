/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../components/GeneralSettings', () => ({ default: () => <div>general settings</div> }))
vi.mock('../../../shellOptions', () => ({ loadShellOptions: () => Promise.resolve([]) }))

const { BuiltinPluginsPage, TerminalPage } = await import('../OmniTermPages')

const save = vi.fn(() => Promise.resolve())
const setEnabled = vi.fn(() => Promise.resolve())

function plugin(id: string, name: string, enabled: boolean): PluginDescriptor {
  return {
    id, name, version: '0.1.0', description: `${name} plugin`, source: 'bundled', enabled,
    status: enabled ? 'loaded' : 'disabled', permissions: [],
  }
}

beforeEach(() => {
  ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
    settings: {
      get: vi.fn(() => Promise.resolve({ darkMode: true, terminalCtrlC: {} })),
      save,
      onChanged: () => () => {},
    },
    workspace: { list: vi.fn(() => Promise.resolve([])) },
    plugin: {
      list: vi.fn(() => Promise.resolve([
        plugin('omniterm.agent-quota', 'Agent quota', true),
        plugin('omniterm.always-awake', 'Always awake', false),
      ])),
      setEnabled,
    },
  }
})
afterEach(() => vi.clearAllMocks())

describe('Settings › Plugins › Installed', () => {
  it('lists OmniTerm\'s bundled plugins with an enable switch each', async () => {
    render(<BuiltinPluginsPage />)
    expect(await screen.findByText('Agent quota')).toBeTruthy()
    expect(screen.getByText('Always awake')).toBeTruthy()
    expect(screen.getAllByText('Bundled')).toHaveLength(2)
    const quota = screen.getByRole('switch', { name: 'Disable Agent quota' })
    expect(quota.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Enable Always awake' }).getAttribute('aria-checked')).toBe('false')
  })

  it('asks before it disables a plugin, then switches it', async () => {
    render(<BuiltinPluginsPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable Agent quota' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith('omniterm.agent-quota', false))
  })
})

describe('Settings › Tools › Terminal', () => {
  it('shows the Ctrl+C rules and saves a change at once', async () => {
    render(<TerminalPage />)
    expect(await screen.findByText('general settings')).toBeTruthy()
    expect(await screen.findByText('Ctrl+C with selection')).toBeTruthy()
    expect(screen.getByLabelText('Double Ctrl+C')).toBeTruthy()
    expect(screen.getByLabelText('Double-press window')).toBeTruthy()
    expect(screen.getByLabelText('Keep tab after exit')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Press Ctrl\+C again to close/))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const saved = (save.mock.calls[0] as unknown as [{ terminalCtrlC: { showHint: boolean } }])[0]
    expect(saved.terminalCtrlC.showHint).toBe(false)
  })
})
