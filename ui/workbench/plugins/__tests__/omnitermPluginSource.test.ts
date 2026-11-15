import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePluginsDialog } from '../../../ide/features/plugins/pluginsDialogStore'
import { registerOmniTermPluginSource, toHostPlugin, type NodePluginAPI } from '../omnitermPluginSource'

const descriptor = (overrides: Partial<PluginDescriptor> = {}): PluginDescriptor => ({
  id: 'omniterm.agent-quota',
  name: 'Agent Quota',
  description: 'Quota guard',
  version: '1.0.0',
  apiVersion: 1,
  hostVersion: '1',
  permissions: [],
  source: 'bundled',
  enabled: true,
  status: 'loaded',
  activeConnectionProvider: false,
  selectedConnectionProvider: false,
  activeAuthProvider: false,
  activeInvokeHandler: false,
  ...overrides,
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function fakeApi(list: PluginDescriptor[]) {
  let changed: () => void = () => {}
  const api: NodePluginAPI = {
    list: vi.fn(() => Promise.resolve(list)),
    setEnabled: vi.fn(() => Promise.resolve(null)),
    builtinIds: () => Promise.resolve(['omniterm.todo-finder']),
    onChanged: (callback) => {
      changed = callback
      return () => { changed = () => {} }
    },
    installPackage: () => Promise.resolve(null),
    restartApp: () => Promise.resolve(),
  }
  return { api, fireChanged: () => changed() }
}

afterEach(() => usePluginsDialog.setState({ open: false, source: null }))

describe('OmniTerm plugins in the Plugins dialog', () => {
  it('lists bundled plugins as built in and user packages as installed, without the plugin host', async () => {
    const list = [
      descriptor(),
      descriptor({ id: 'acme.extra', name: 'Extra', source: 'user', enabled: false }),
      descriptor({ id: 'omniterm.plugin-host', name: 'Host' }),
    ]
    const { api } = fakeApi(list)
    const stop = registerOmniTermPluginSource(api, () => null)
    await flush()
    const source = usePluginsDialog.getState().source
    expect(source?.builtinPluginIds).toEqual(['omniterm.todo-finder'])
    expect(source?.plugins().map((p) => [p.id, p.builtin, p.enabled])).toEqual([
      ['omniterm.agent-quota', true, true],
      ['acme.extra', false, false],
    ])
    stop()
    expect(usePluginsDialog.getState().source).toBeNull()
  })

  it('reloads when a plugin changes anywhere, and after enabling one here', async () => {
    const { api, fireChanged } = fakeApi([descriptor()])
    const stop = registerOmniTermPluginSource(api, () => null)
    await flush()
    const listener = vi.fn()
    usePluginsDialog.getState().source?.subscribe(listener)
    fireChanged()
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
    await usePluginsDialog.getState().source?.setEnabled('omniterm.agent-quota', false)
    await flush()
    expect(api.setEnabled).toHaveBeenCalledWith('omniterm.agent-quota', false)
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reports a plugin that failed to load', () => {
    expect(toHostPlugin(descriptor({ status: 'error', error: 'boom' })).error).toBe('boom')
    expect(toHostPlugin(descriptor({ status: 'incompatible' })).error).toBe('incompatible')
    expect(toHostPlugin(descriptor()).error).toBeUndefined()
  })
})
