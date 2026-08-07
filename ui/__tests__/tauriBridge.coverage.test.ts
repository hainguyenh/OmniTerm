/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diag'

const state = vi.hoisted(() => ({
  platform: 'linux' as string | Error,
  label: '',
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  writeText: vi.fn(),
  readText: vi.fn(),
  homeDir: vi.fn(),
  startSession: vi.fn(),
  attachSession: vi.fn(),
  failSession: vi.fn(),
  onSession: vi.fn((_id?: string, _cb?: any) => vi.fn()),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => state.invoke(...args),
  convertFileSrc: (path: string) => state.convertFileSrc(path),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => state.listen(...args),
}))
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => {
    if (state.platform instanceof Error) throw state.platform
    return state.platform
  },
}))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: unknown[]) => state.writeText(...args),
  readText: (...args: unknown[]) => state.readText(...args),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => state.open(...args),
}))
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: (...args: unknown[]) => state.homeDir(...args),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: state.label }),
}))
vi.mock('../tauriSessions', () => ({
  startSession: (...args: unknown[]) => state.startSession(...args),
  attachSession: (...args: unknown[]) => state.attachSession(...args),
  failSession: (...args: unknown[]) => state.failSession(...args),
  onSession: (id: string, callback: any) => state.onSession(id, callback),
}))

const { __createTauriAPIForTests } = await import('../omnitermAPI')

beforeEach(() => {
  vi.clearAllMocks()
  state.platform = 'linux'
  state.label = ''
  state.invoke.mockResolvedValue(undefined)
  state.listen.mockResolvedValue(vi.fn())
  state.open.mockResolvedValue(null)
  state.readText.mockResolvedValue('clip')
  state.homeDir.mockResolvedValue('/home/test')
  state.startSession.mockResolvedValue(undefined)
  state.attachSession.mockResolvedValue(null)
  document.body.style.zoom = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('complete Tauri bridge behavior', () => {
  it('maps every platform and recognizes detached window labels safely', () => {
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {})
    state.platform = 'macos'
    expect(__createTauriAPIForTests().app.platform).toBe('darwin')
    state.platform = 'windows'
    expect(__createTauriAPIForTests().app.platform).toBe('win32')
    state.platform = 'linux'
    expect(__createTauriAPIForTests().app.platform).toBe('linux')
    state.platform = 'freebsd'
    expect(__createTauriAPIForTests().app.platform).toBe('unknown')
    state.platform = new Error('OS unavailable')
    expect(__createTauriAPIForTests().app.platform).toBe('unknown')
    expect(warn).toHaveBeenCalledWith('[omnitermAPI] Failed to get OS platform', state.platform)

    state.platform = 'linux'
    state.label = 'term-window-1'
    expect(__createTauriAPIForTests().terminalWindow.detachedSessionId).toBe('term-window-1')
    state.label = 'main'
    expect(__createTauriAPIForTests().terminalWindow.detachedSessionId).toBeNull()
  })

  it('forwards connection and plugin calls and applies provider fallbacks', async () => {
    const api = __createTauriAPIForTests()
    state.invoke.mockResolvedValueOnce({ connections: [] })
    await api.connections.load()
    await api.connections.save({ connections: ['c1'] })
    expect(state.invoke).toHaveBeenCalledWith('load_connections')
    expect(state.invoke).toHaveBeenCalledWith('save_connections', {
      data: { connections: ['c1'] },
    })

    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.available()).resolves.toBe(false)
    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.list()).resolves.toEqual([])
    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.setEnabled('p1', true)).resolves.toBeNull()
    await api.plugin.selectConnectionProvider(null)
    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.connectionCapabilities()).resolves.toBeNull()
    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.invoke('method', 1, 'two')).resolves.toBeNull()
    state.invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(api.plugin.authGate()).resolves.toBe(true)
    await api.plugin.installPackage()
    await api.plugin.remove('p1')
    await api.plugin.restartApp()
    expect(state.invoke).toHaveBeenCalledWith('plugin_select_connection_provider', { id: null })
    expect(state.invoke).toHaveBeenCalledWith('plugin_invoke', {
      method: 'method',
      args: [1, 'two'],
    })
    expect(state.invoke).toHaveBeenCalledWith('remove_plugin', { id: 'p1' })
  })

  it('covers SSH handlers, metrics, RDP lifecycle and compatibility no-ops', async () => {
    const api = __createTauriAPIForTests()
    await api.connect.ssh('ssh-1')
    expect(state.invoke).toHaveBeenCalledWith('prepare_ssh_session', { connId: 'ssh-1' })
    expect(state.startSession).toHaveBeenCalledWith('ssh-1', 'ssh-1', 'cmd')

    state.invoke.mockRejectedValueOnce('prepare refused')
    await api.connect.ssh('ssh-bad')
    expect(state.failSession).toHaveBeenCalledWith('ssh-bad', 'prepare refused')
    api.connect.sshInput('ssh-1', 'dir\r')
    api.connect.sshResize('ssh-1', { cols: 80, rows: 25 })
    api.connect.sshDisconnect('ssh-1')
    api.connect.onSSHReady('ssh-1', vi.fn())
    api.connect.onSSHData('ssh-1', vi.fn())
    api.connect.onSSHError('ssh-1', vi.fn())
    api.connect.onSSHClosed('ssh-1', vi.fn())
    expect(state.onSession).toHaveBeenCalledTimes(4)

    const metrics = vi.fn()
    api.connect.onSessionMetrics('ssh-1', metrics)
    const eventHandler = state.listen.mock.calls.at(-1)?.[1]
    eventHandler?.({ payload: { cpu: 3 } })
    expect(metrics).toHaveBeenCalledWith({ cpu: 3 })

    expect(api.connect.rdpInput('r', 'x')).toBeUndefined()
    expect(api.connect.rdpResize('r', { cols: 1, rows: 1 })).toBeUndefined()
    expect(api.connect.rdpSetOverlay()).toBeUndefined()
    expect(api.connect.rdpSetDetached()).toBeUndefined()
    await expect(api.connect.rdpResetTrust('host', '3389')).resolves.toBeUndefined()
    await expect(api.connect.overlayInit()).resolves.toBeNull()
    expect(api.connect.onRDPDetachState(vi.fn())()).toBeUndefined()
    expect(api.connect.onRDPLatency('r', vi.fn())()).toBeUndefined()
  })

  it('moves detached sessions and keeps clipboard and SFTP stubs honest', async () => {
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    const api = __createTauriAPIForTests()
    state.invoke.mockResolvedValueOnce(true)
    await expect(api.terminalWindow.detach({
      sessionId: 's1',
      name: 'Shell',
      connection: { id: 'c1' },
    })).resolves.toBe(true)
    expect(state.invoke).toHaveBeenCalledWith('detach_terminal', {
      sessionId: 's1',
      name: 'Shell',
      connection: { id: 'c1' },
    })
    state.invoke.mockRejectedValueOnce(new Error('no window'))
    await expect(api.terminalWindow.detach({
      sessionId: 's2', name: 'Shell', connection: {},
    })).resolves.toBe(false)
    expect(error).toHaveBeenCalledWith('[omnitermAPI] detach failed', expect.any(Error))
    state.invoke.mockRejectedValueOnce(new Error('no bootstrap'))
    await expect(api.terminalWindow.bootstrap()).resolves.toBeNull()

    state.attachSession.mockResolvedValueOnce({ id: 's1', data: [1, 2], closed: false })
    const snapshot = await api.terminalWindow.resume('s1')
    expect(snapshot.data).toEqual(new Uint8Array(0))
    state.attachSession.mockResolvedValueOnce(null)
    await expect(api.terminalWindow.resume('missing')).resolves.toBeNull()
    state.invoke.mockRejectedValueOnce(new Error('gone'))
    await expect(api.terminalWindow.reattach('s1')).resolves.toBe(false)
    api.terminalWindow.focus('s1')
    api.terminalWindow.release('s1')
    api.terminalWindow.onReattached(vi.fn())
    api.terminalWindow.onClosed(vi.fn())

    await api.clipboard.writeText('copy')
    await expect(api.clipboard.readText()).resolves.toBe('clip')
    expect(state.writeText).toHaveBeenCalledWith('copy')
    await expect(api.sftp.home('x')).resolves.toBe('')
    await expect(api.sftp.list('x', '/')).resolves.toEqual([])
    await expect(api.sftp.realpath('x', '/')).resolves.toBe('')
    await expect(api.sftp.mkdir('x', '/d')).resolves.toBeUndefined()
    await expect(api.sftp.rename('x', '/a', '/b')).resolves.toBeUndefined()
    await expect(api.sftp.delete('x', '/a')).resolves.toBeUndefined()
    await expect(api.sftp.rmdirRecursive('x', '/d')).resolves.toBeUndefined()
    await expect(api.sftp.download('x', '/a', 'a')).resolves.toBe(false)
    await expect(api.sftp.upload('x', '/')).resolves.toBe(0)
    expect(api.sftp.onProgress('x', vi.fn())()).toBeUndefined()
  })

  it('forwards app, file and custom-art operations including cancel paths', async () => {
    const api = __createTauriAPIForTests()
    await api.app.revealLog()
    await api.app.clearLog()
    api.app.setZoomFactor(1.25)
    expect(api.app.getZoomFactor()).toBe(1.25)
    state.invoke.mockRejectedValueOnce(new Error('zoom refused'))
    api.app.setZoomFactor(1.5)
    await Promise.resolve()
    expect(document.body.style.zoom).toBe('1.5')

    await api.files.exportJson({ suggestedName: 'data.json', content: '{}' })
    await api.files.importJson()
    await api.files.importFile()
    await expect(api.files.getHomeDir()).resolves.toBe('/home/test')
    state.open.mockResolvedValueOnce('/workspace')
    await expect(api.files.pickDirectory('/start')).resolves.toBe('/workspace')
    state.open.mockResolvedValueOnce(['/not-supported'])
    await expect(api.files.pickDirectory()).resolves.toBeNull()

    state.open.mockResolvedValueOnce('/tmp/art.png')
    state.invoke.mockResolvedValueOnce('/stored/art.png')
    await expect(api.customArt.upload('idle-light')).resolves.toMatch(/^asset:\/\/\/stored\/art\.png\?t=\d+$/)
    state.open.mockResolvedValueOnce(null)
    await expect(api.customArt.upload('idle-dark')).rejects.toThrow('cancelled')
    state.invoke.mockResolvedValueOnce('/stored/art.png')
    await expect(api.customArt.get('idle-light')).resolves.toMatch(/^asset:\/\/\/stored\/art\.png\?t=\d+$/)
    state.invoke.mockResolvedValueOnce(null)
    await expect(api.customArt.get('idle-dark')).resolves.toBeNull()

    await api.customArt.remove('idle-dark')
  })

  it('forwards settings, workspace, updater, theme and window commands exactly', async () => {
    const api = __createTauriAPIForTests()
    await api.settings.get()
    await api.settings.save({ fontSize: 17 })
    api.settings.onChanged(vi.fn())
    await api.settings.systemExcludedViewExts()

    await api.workspace.list()
    state.open.mockResolvedValueOnce('/project')
    await api.workspace.add()
    state.open.mockResolvedValueOnce(null)
    await expect(api.workspace.add()).resolves.toBeNull()
    await api.workspace.remove('w1')
    await api.workspace.scanScripts('w1')
    await api.workspace.scanFolders('w1')
    await api.workspace.scanFolderEntries('w1')
    await api.workspace.scanFolderEntries('w1', 'src', 4, 20)
    await api.workspace.run({ workspaceId: 'w1' })
    await api.workspace.run({ workspaceId: 'w1', script: { id: 'a' }, subPath: 'src' })
    await api.workspace.readScript('w1', 'a.txt')
    await api.workspace.writeScript('w1', 'run.sh', 'echo hi')
    state.invoke.mockRejectedValueOnce(new Error('missing'))
    await expect(api.workspace.loadConnections('w1')).resolves.toEqual([])
    await api.workspace.saveConnections('w1', [{ id: 'c1' }])
    await api.workspace.deleteConnection('w1', 'c1')

    await expect(api.updates.check()).resolves.toBeNull()
    await expect(api.updates.state()).resolves.toBeNull()
    await expect(api.updates.skip(null)).resolves.toBeUndefined()
    await api.updates.getVersion()
    await expect(api.updates.showSaveDialog('x')).resolves.toBeNull()
    await expect(api.updates.downloadPortable('/x')).resolves.toBeUndefined()
    await expect(api.updates.downloadInstaller(true)).resolves.toBeUndefined()
    expect(api.updates.onState(vi.fn())()).toBeUndefined()

    await api.themes.list()
    await api.themes.openFolder()
    await api.themes.save({ id: 't1' })
    await api.themes.delete('t1')
    await api.windowControl.minimize()
    await api.windowControl.toggleMaximize()
    await api.windowControl.close()
    await api.windowControl.isMaximized()
  })

  it('covers shell launcher calls and event-listen rejection cleanup', async () => {
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    const api = __createTauriAPIForTests()
    api.shells.ready()
    await Promise.resolve()
    expect(state.invoke).toHaveBeenCalledWith('setup_launcher')
    expect(state.invoke).toHaveBeenCalledWith('shells_ready')
    api.shells.release('c1')
    await api.shells.open()
    await api.shells.open('bash')
    await api.shells.list()
    api.shells.onOpen(vi.fn())

    state.listen.mockRejectedValueOnce(new Error('listener unavailable'))
    const off = api.settings.onChanged(vi.fn())
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    off()
    expect(off()).toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      '[omnitermAPI] failed to listen for settings:changed',
      expect.any(Error),
    )
  })
})
