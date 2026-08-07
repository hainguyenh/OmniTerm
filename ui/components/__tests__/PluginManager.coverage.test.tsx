/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import PluginManager from '../PluginManager'

const full: PluginDescriptor = {
  id: '@omniterm/full-connection-manager', name: 'Full Manager', description: 'Full provider', version: '1.0.0',
  apiVersion: 1, hostVersion: '1', permissions: ['connections', 'workspace'], source: 'bundled', enabled: true,
  status: 'loaded', activeConnectionProvider: true, selectedConnectionProvider: true,
  activeAuthProvider: false, activeInvokeHandler: false,
}
const batch: PluginDescriptor = {
  ...full, id: '@omniterm/native-batch-connections', name: 'Native Batch', source: 'user',
  selectedConnectionProvider: false, description: undefined,
}
const custom: PluginDescriptor = {
  ...full, id: 'custom-plugin', name: 'Custom', permissions: ['openExternal', 'clipboard'], source: 'user',
  enabled: false, status: 'error', error: 'broken', activeConnectionProvider: false, selectedConnectionProvider: false,
  description: undefined,
}
const incompatible: PluginDescriptor = {
  ...custom, id: 'old-plugin', name: 'Old', status: 'incompatible', error: undefined,
}
const host: PluginDescriptor = { ...full, id: 'omniterm.plugin-host', name: 'Host', activeConnectionProvider: false, selectedConnectionProvider: false, description: undefined }
const capabilities: ConnectionProviderCapabilities = {
  protocols: ['SSH', 'RDP'], credentialPolicy: 'prompt-every-time', scopes: ['personal', 'workspace'], sftp: true, importExport: true,
}

function api(overrides: Record<string, unknown> = {}) {
  const plugin = {
    list: vi.fn(async () => [full, batch, custom, incompatible, host]),
    connectionCapabilities: vi.fn(async () => capabilities),
    installPackage: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    restartApp: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => ({})),
    selectConnectionProvider: vi.fn(async () => [full, batch]),
    ...((overrides.plugin as object) ?? {}),
  }
  const connections = {
    load: vi.fn(async () => ({ connections: [], folders: [] })),
    save: vi.fn(async () => {}),
    ...((overrides.connections as object) ?? {}),
  }
  const files = {
    exportJson: vi.fn(async () => true),
    importFile: vi.fn(async () => null),
    ...((overrides.files as object) ?? {}),
  }
  mockOmnitermAPI({ plugin, connections, files })
  return { plugin, connections, files }
}

function setup({ activeSessionCount = 0, confirmations = [true], showAlert = vi.fn(async () => {}) } = {}) {
  const onProviderStatusChanged = vi.fn()
  const answers = [...confirmations]
  const showConfirm = vi.fn(async () => answers.shift() ?? false)
  const view = render(<PluginManager activeSessionCount={activeSessionCount}
    onProviderStatusChanged={onProviderStatusChanged} showAlert={showAlert} showConfirm={showConfirm} />)
  return { ...view, showAlert, showConfirm, onProviderStatusChanged }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('PluginManager complete behavior', () => {
  it('refreshes descriptors, summaries, errors, capabilities, and reports provider state', async () => {
    api()
    const x = setup()
    await screen.findByText('Full Manager')
    expect(screen.getByText('4 installed')).toBeInTheDocument()
    for (const feature of ['Integrated SSH', 'Native RDP', 'BAT launchers', 'open External', 'clipboard']) {
      expect(screen.getAllByText(feature).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('broken')).toBeInTheDocument()
    expect(screen.getByText('Full provider')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable Old' })).toBeDisabled()
    expect(screen.getByText('Active connection provider')).toBeDisabled()
    expect(screen.getByText('Import metadata')).toBeInTheDocument()
    expect(screen.getByText('Export metadata')).toBeInTheDocument()
    expect(x.onProviderStatusChanged).toHaveBeenCalledWith(true)
  })

  it('reports refresh failures for Error and non-Error values and renders empty state', async () => {
    api({ plugin: { list: vi.fn(async () => { throw new Error('offline') }) } })
    const first = setup()
    await waitFor(() => expect(first.showAlert).toHaveBeenCalledWith('Could not load plugins: offline', expect.objectContaining({ tone: 'error' })))
    expect(screen.getByText('No compatible plugins discovered.')).toBeInTheDocument()
    first.unmount()

    api({ plugin: { list: vi.fn(async () => { throw 'plain failure' }) } })
    const second = setup()
    await waitFor(() => expect(second.showAlert).toHaveBeenCalledWith('Could not load plugins: plain failure', expect.anything()))
  })

  it('installs canceled, ready, restart-required, and failed packages', async () => {
    const canceled = api()
    const x = setup()
    await screen.findByText('Full Manager')
    fireEvent.click(screen.getByText('Install ZIP'))
    await waitFor(() => expect(canceled.plugin.installPackage).toHaveBeenCalled())
    expect(x.showAlert).not.toHaveBeenCalled()
    x.unmount()

    const ready = api({ plugin: { installPackage: vi.fn(async () => ({ name: 'Ready', version: '2.0', restartRequired: false })) } })
    const readyView = setup()
    await screen.findByText('Full Manager')
    fireEvent.click(screen.getByText('Install ZIP'))
    await waitFor(() => expect(readyView.showAlert).toHaveBeenCalledWith(expect.stringContaining('ready to configure'), expect.anything()))
    expect(ready.plugin.list).toHaveBeenCalledTimes(2)
    readyView.unmount()

    api({ plugin: { installPackage: vi.fn(async () => ({ name: 'Restarted', version: '3.0', restartRequired: true })) } })
    const restart = setup({ confirmations: [true] })
    await screen.findByText('Full Manager')
    fireEvent.click(screen.getByText('Install ZIP'))
    await screen.findByText('Restart required to finish plugin changes.')
    fireEvent.click(screen.getByText('Restart now'))
    await waitFor(() => expect(window.omnitermAPI.plugin.restartApp).toHaveBeenCalled())
    restart.unmount()

    api({ plugin: { installPackage: vi.fn(async () => { throw 'bad zip' }) } })
    const failed = setup()
    await screen.findByText('Full Manager')
    fireEvent.click(screen.getByText('Install ZIP'))
    await waitFor(() => expect(failed.showAlert).toHaveBeenCalledWith('Could not install plugin: bad zip', expect.anything()))
  })

  it('guards, cancels, removes, and reports removal failures', async () => {
    api()
    const active = setup({ activeSessionCount: 1 })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getAllByText('Remove plugin')[0])
    await waitFor(() => expect(active.showAlert).toHaveBeenCalledWith(expect.stringContaining('Close all active sessions'), expect.anything()))
    expect(window.omnitermAPI.plugin.remove).not.toHaveBeenCalled()
    active.unmount()

    api()
    const canceled = setup({ confirmations: [false] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getAllByText('Remove plugin')[0])
    await waitFor(() => expect(canceled.showConfirm).toHaveBeenCalled())
    expect(window.omnitermAPI.plugin.remove).not.toHaveBeenCalled()
    canceled.unmount()

    const good = api()
    const removed = setup({ confirmations: [true] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getAllByText('Remove plugin')[0])
    await waitFor(() => expect(good.plugin.remove).toHaveBeenCalledWith(batch.id))
    expect(good.plugin.list).toHaveBeenCalledTimes(2)
    removed.unmount()

    api({ plugin: { remove: vi.fn(async () => { throw new Error('locked') }) } })
    const failed = setup({ confirmations: [true] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getAllByText('Remove plugin')[0])
    await waitFor(() => expect(failed.showAlert).toHaveBeenCalledWith('Could not remove plugin: locked', expect.anything()))
  })

  it('guards, cancels, enables, disables, and reports toggle failures', async () => {
    api()
    const active = setup({ activeSessionCount: 1 })
    await screen.findByText('Custom')
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Full Manager' }))
    await waitFor(() => expect(active.showAlert).toHaveBeenCalledWith(expect.stringContaining('changing a connection-provider'), expect.anything()))
    active.unmount()

    api()
    const canceled = setup({ confirmations: [false] })
    await screen.findByText('Custom')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Custom' }))
    await waitFor(() => expect(canceled.showConfirm).toHaveBeenCalledWith(expect.stringContaining('Enable “Custom”'), expect.anything()))
    expect(window.omnitermAPI.plugin.setEnabled).not.toHaveBeenCalled()
    canceled.unmount()

    const list = vi.fn()
      .mockResolvedValueOnce([full, batch, custom, incompatible, host])
      .mockResolvedValueOnce([{ ...custom, enabled: true, selectedConnectionProvider: true }])
    const good = api({ plugin: { list } })
    const enabled = setup({ confirmations: [true] })
    await screen.findByText('Custom')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Custom' }))
    await waitFor(() => expect(good.plugin.setEnabled).toHaveBeenCalledWith(custom.id, true))
    expect(enabled.onProviderStatusChanged).toHaveBeenLastCalledWith(true)
    enabled.unmount()

    const disableList = vi.fn()
      .mockResolvedValueOnce([full])
      .mockResolvedValueOnce([{ ...full, enabled: false, selectedConnectionProvider: false }])
    const disabledApi = api({ plugin: { list: disableList } })
    const disabled = setup({ confirmations: [true] })
    await screen.findByText('Full Manager')
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Full Manager' }))
    await waitFor(() => expect(disabledApi.plugin.setEnabled).toHaveBeenCalledWith(full.id, false))
    expect(disabled.onProviderStatusChanged).toHaveBeenLastCalledWith(false)
    disabled.unmount()

    api({ plugin: { setEnabled: vi.fn(async () => { throw 'denied' }) } })
    const failed = setup({ confirmations: [true] })
    await screen.findByText('Custom')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Custom' }))
    await waitFor(() => expect(failed.showAlert).toHaveBeenCalledWith('Could not enable plugin: denied', expect.anything()))
  })

  it('switches providers with optional migration and handles active, canceled, and failed selection', async () => {
    api()
    const active = setup({ activeSessionCount: 1 })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getByText('Use for connections'))
    await waitFor(() => expect(active.showAlert).toHaveBeenCalledWith(expect.stringContaining('switching connection providers'), expect.anything()))
    active.unmount()

    api()
    const canceled = setup({ confirmations: [false] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getByText('Use for connections'))
    await waitFor(() => expect(canceled.showConfirm).toHaveBeenCalled())
    expect(window.omnitermAPI.plugin.selectConnectionProvider).not.toHaveBeenCalled()
    canceled.unmount()

    const migrated = api({ connections: { load: vi.fn(async () => ({ connections: [{ id: 'one' }], folders: [] })) } })
    const switched = setup({ confirmations: [true, true] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getByText('Use for connections'))
    await waitFor(() => expect(migrated.plugin.selectConnectionProvider).toHaveBeenCalledWith(batch.id))
    expect(migrated.connections.save).toHaveBeenCalledWith(expect.objectContaining({ connections: [{ id: 'one' }] }))
    expect(switched.onProviderStatusChanged).toHaveBeenLastCalledWith(true)
    switched.unmount()

    api({ plugin: { selectConnectionProvider: vi.fn(async () => { throw new Error('host down') }) } })
    const failed = setup({ confirmations: [true] })
    await screen.findByText('Native Batch')
    fireEvent.click(screen.getByText('Use for connections'))
    await waitFor(() => expect(failed.showAlert).toHaveBeenCalledWith('Could not select the provider: host down', expect.anything()))
  })

  it('exports and imports metadata across success, cancel, missing-file, and failure branches', async () => {
    const good = api({
      connections: { load: vi.fn(async () => ({ connections: [{ id: 'one' }], folders: [{ id: 'f' }] })) },
      files: { importFile: vi.fn(async () => ({ connections: [{ id: 'two' }], folders: [] })) },
    })
    const x = setup({ confirmations: [true] })
    await screen.findByText('Export metadata')
    fireEvent.click(screen.getByText('Export metadata'))
    await waitFor(() => expect(good.files.exportJson).toHaveBeenCalled())
    const exported = JSON.parse((good.files.exportJson.mock.calls as any)[0][0].content)
    expect(exported).toMatchObject({ format: 'omniterm-connections', version: 1, provider: full.id })
    fireEvent.click(screen.getByText('Import metadata'))
    await waitFor(() => expect(good.connections.save).toHaveBeenCalledWith({ connections: [{ id: 'two' }], folders: [] }))
    x.unmount()

    api({ files: { importFile: vi.fn(async () => null) } })
    const empty = setup()
    await screen.findByText('Import metadata')
    fireEvent.click(screen.getByText('Import metadata'))
    await waitFor(() => expect(window.omnitermAPI.files.importFile).toHaveBeenCalled())
    expect(window.omnitermAPI.connections.save).not.toHaveBeenCalled()
    empty.unmount()

    api({ files: { importFile: vi.fn(async () => ({ connections: [], folders: [] })) } })
    const canceled = setup({ confirmations: [false] })
    await screen.findByText('Import metadata')
    fireEvent.click(screen.getByText('Import metadata'))
    await waitFor(() => expect(canceled.showConfirm).toHaveBeenCalled())
    expect(window.omnitermAPI.connections.save).not.toHaveBeenCalled()
    canceled.unmount()

    api({ files: { importFile: vi.fn(async () => { throw 'bad json' }) } })
    const failed = setup()
    await screen.findByText('Import metadata')
    fireEvent.click(screen.getByText('Import metadata'))
    await waitFor(() => expect(failed.showAlert).toHaveBeenCalledWith('Could not import metadata: bad json', expect.anything()))
  })
})
