/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  scan: vi.fn(),
  attach: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => state.invoke(...args),
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => state.listen(...args) }))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue('clip'),
  readImage: async () => { throw new Error('no image') },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => state.open(...args) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn().mockResolvedValue('C:/Users/me') }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'term-7' }) }))
vi.mock('../tauriSessions', () => ({ attachSession: (...args: unknown[]) => state.attach(...args) }))
vi.mock('../utils/paneAgentScan', () => ({ scanPaneAgents: () => state.scan() }))
vi.mock('../diag', () => ({ diag: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { __createTauriAPIForTests } from '../omnitermAPI'

function api() {
  return __createTauriAPIForTests()
}

describe('omnitermAPI surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.invoke.mockResolvedValue(undefined)
    state.listen.mockResolvedValue(vi.fn())
  })

  it('maps the platform and the detached window marker', () => {
    const a = api()
    expect(a.app.platform).toBe('win32')
    expect(a.terminalWindow.detachedSessionId).toBe('term-7')
  })

  it('falls back when plugin commands are unavailable', async () => {
    state.invoke.mockRejectedValue(new Error('missing'))
    const { plugin } = api()
    await expect(plugin.list()).resolves.toEqual([])
    await expect(plugin.builtinIds()).resolves.toEqual([])
    await expect(plugin.setEnabled('a', true)).resolves.toBeNull()
  })

  it('forwards plugin commands with their arguments', async () => {
    const { plugin } = api()
    await plugin.setEnabled('p', false)
    expect(state.invoke).toHaveBeenCalledWith('omni_plugin_set_enabled', { id: 'p', enabled: false })
  })

  it('delivers broadcast events and unsubscribes synchronously', async () => {
    const unlisten = vi.fn()
    const handlers = new Map<string, (event: { payload: unknown }) => void>()
    state.listen.mockImplementation(async (name: string, cb: (event: { payload: unknown }) => void) => {
      handlers.set(name, cb)
      return unlisten
    })
    const a = api()
    const changed = vi.fn()
    const stop = a.plugin.onChanged(changed)
    const closed = vi.fn()
    const stopClosed = a.terminalWindow.onClosed(closed)
    const reattached = vi.fn()
    const stopReattached = a.terminalWindow.onReattached(reattached)
    const context = vi.fn()
    const stopContext = a.terminalWindow.onContext(context)
    const maximized = vi.fn()
    const stopMax = a.windowControl.onMaximizedState(maximized)
    const opened = vi.fn()
    const stopOpen = a.shells.onOpen(opened)
    const settings = vi.fn()
    const stopSettings = a.settings.onChanged(settings)
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.get('omniterm://plugins-changed')?.({ payload: 1 })
    handlers.get('terminal-window-closed')?.({ payload: 's1' })
    handlers.get('terminal-window-reattached')?.({ payload: 's2' })
    handlers.get('terminal-window-context')?.({ payload: { sessionId: 's3' } })
    handlers.get('maximized-state')?.({ payload: true })
    handlers.get('shell-open')?.({ payload: { id: 'c' } })
    handlers.get('settings:changed')?.({ payload: { a: 1 } })
    expect(changed).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledWith('s1')
    expect(reattached).toHaveBeenCalledWith('s2')
    expect(context).toHaveBeenCalledWith({ sessionId: 's3' })
    expect(maximized).toHaveBeenCalledWith(true)
    expect(opened).toHaveBeenCalledWith({ id: 'c' })
    expect(settings).toHaveBeenCalledWith({ a: 1 })
    for (const stopFn of [stop, stopClosed, stopReattached, stopContext, stopMax, stopOpen, stopSettings]) stopFn()
    expect(unlisten).toHaveBeenCalledTimes(7)
  })

  it('handles the detached terminal window commands', async () => {
    const { terminalWindow } = api()
    state.invoke.mockRejectedValue(new Error('x'))
    await expect(terminalWindow.detach({ sessionId: 's', name: 'n', connection: {} })).resolves.toBe(false)
    await expect(terminalWindow.bootstrap()).resolves.toBeNull()
    await expect(terminalWindow.reattach('s')).resolves.toBe(false)
    await expect(terminalWindow.reportContext('s', { cwd: 'C:/x' })).resolves.toBeUndefined()
    terminalWindow.focus('s')
    terminalWindow.release('s')
    state.invoke.mockResolvedValue(true)
    await expect(terminalWindow.detach({ sessionId: 's', name: 'n', connection: {} })).resolves.toBe(true)
    state.attach.mockResolvedValueOnce({ cols: 80, rows: 24 })
    await expect(terminalWindow.resume('s')).resolves.toMatchObject({ cols: 80, data: new Uint8Array(0) })
    state.attach.mockResolvedValueOnce(null)
    await expect(terminalWindow.resume('s')).resolves.toBeNull()
  })

  it('reads and writes the clipboard', async () => {
    const { clipboard } = api()
    await clipboard.writeText('x')
    await expect(clipboard.readText()).resolves.toBe('clip')
    await expect(clipboard.readImage()).resolves.toBeNull()
    state.invoke.mockResolvedValue('C:/tmp/img.png')
    await expect(clipboard.saveImageTemp(new Uint8Array([1]), 's')).resolves.toBe('C:/tmp/img.png')
  })

  it('uploads attachments with encoded headers', async () => {
    const { attachments } = api()
    state.invoke.mockResolvedValue({ id: 'a', name: 'n', path: 'p', size: 1 })
    await attachments.save('a b.txt', new Uint8Array([1]), 's 1').catch(() => undefined)
    await attachments.save('plain.txt', new Uint8Array([1])).catch(() => undefined)
    const [, , options] = state.invoke.mock.calls[0] as [string, unknown, { headers: Record<string, string> }]
    expect(options.headers['x-omniterm-attachment-name']).toBe('a%20b.txt')
    expect(options.headers['x-omniterm-session-id']).toBe('s%201')
    const [, , plain] = state.invoke.mock.calls[1] as [string, unknown, { headers: Record<string, string> }]
    expect(plain.headers['x-omniterm-session-id']).toBeUndefined()
    state.invoke.mockRejectedValue(new Error('denied'))
    await expect(attachments.importClipboardFiles('s')).resolves.toEqual([])
  })

  it('keeps the SFTP surface inert', async () => {
    const { sftp } = api()
    await expect(sftp.home('c')).resolves.toBe('')
    await expect(sftp.list('c', '/')).resolves.toEqual([])
    await expect(sftp.realpath('c', '/')).resolves.toBe('')
    await expect(sftp.download('c', '/a', 'a')).resolves.toBe(false)
    await expect(sftp.upload('c', '/')).resolves.toBe(0)
    await sftp.mkdir('c', '/a')
    await sftp.rename('c', '/a', '/b')
    await sftp.delete('c', '/a')
    await sftp.rmdirRecursive('c', '/a')
    expect(sftp.onProgress('c', () => {})).toBeTypeOf('function')
  })

  it('tracks the zoom factor and falls back to CSS zoom', async () => {
    const { app } = api()
    expect(app.getZoomFactor()).toBe(1)
    state.invoke.mockRejectedValue(new Error('refused'))
    app.setZoomFactor(1.25)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.getZoomFactor()).toBe(1.25)
    expect(document.body.style.zoom).toBe('1.25')
    await app.openInSystem('C:/x')
    state.invoke.mockResolvedValue('log')
    await app.revealLog()
    await app.clearLog()
  })

  it('forwards file import and export commands', async () => {
    const { files } = api()
    await files.exportJson({ suggestedName: 'a.json', content: '{}' })
    await files.exportText({ suggestedName: 'a.txt', content: 'x' })
    await files.importJson()
    await files.importFile()
    await expect(files.getHomeDir()).resolves.toBe('C:/Users/me')
    state.open.mockResolvedValueOnce('C:/dir')
    await expect(files.pickDirectory('C:/')).resolves.toBe('C:/dir')
    state.open.mockResolvedValueOnce(['x'])
    await expect(files.pickDirectory()).resolves.toBeNull()
  })

  it('manages custom art', async () => {
    const { customArt } = api()
    state.open.mockResolvedValueOnce('C:/pic.png')
    state.invoke.mockResolvedValueOnce('C:/store/pic.png')
    await expect(customArt.upload('idle-dark')).resolves.toMatch(/^asset:\/\/C:\/store\/pic\.png\?t=\d+$/)
    state.open.mockResolvedValueOnce(null)
    await expect(customArt.upload('idle-dark')).rejects.toThrow('cancelled')
    state.invoke.mockResolvedValueOnce('C:/store/a.png')
    await expect(customArt.get('session-light')).resolves.toMatch(/^asset:\/\//)
    state.invoke.mockResolvedValueOnce(null)
    await expect(customArt.get('session-light')).resolves.toBeNull()
    await customArt.remove('session-light')
    expect(state.invoke).toHaveBeenLastCalledWith('remove_custom_art', { slot: 'session-light' })
  })

  it('forwards settings, theme and window commands', async () => {
    const a = api()
    await a.settings.get()
    await a.settings.save({ x: 1 })
    await a.settings.exportAll()
    await a.settings.importAll({} as never, 'merge')
    await a.settings.systemExcludedViewExts()
    await a.themes.list()
    await a.themes.openFolder()
    await a.themes.save({ id: 't' })
    await a.themes.delete('t')
    await a.windowControl.minimize()
    await a.windowControl.toggleMaximize()
    await a.windowControl.close()
    await a.windowControl.isMaximized()
    await a.windowControl.setFullscreen(true)
    await a.updates.nativeCheck()
    await a.updates.nativeInstall()
    await a.connections.load()
    await a.connections.save([])
    const names = state.invoke.mock.calls.map((call) => call[0])
    for (const name of ['get_settings', 'save_settings', 'export_settings', 'import_settings', 'list_themes', 'save_theme',
      'delete_theme', 'minimize_window', 'toggle_maximize', 'close_window', 'is_maximized', 'set_fullscreen',
      'check_for_native_update', 'download_and_install_update', 'load_connections', 'save_connections']) {
      expect(names).toContain(name)
    }
  })

  it('opens shells with only the supplied options', async () => {
    const { shells } = api()
    await shells.open()
    expect(state.invoke).toHaveBeenLastCalledWith('open_quick_shell', { shell: null, workspaceId: null })
    await shells.open('pwsh', 'w', 'f', 'C:/x', 'ls')
    expect(state.invoke).toHaveBeenLastCalledWith('open_quick_shell', {
      shell: 'pwsh', workspaceId: 'w', folderId: 'f', cwd: 'C:/x', command: 'ls',
    })
    await shells.list()
    shells.release('c')
    shells.ready()
    state.invoke.mockRejectedValue(new Error('x'))
    shells.release('c')
    shells.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('resolves agent session data and tolerates failures', async () => {
    const { agentSessions } = api()
    state.scan.mockResolvedValueOnce([{ id: 1 }])
    await expect(agentSessions.detect()).resolves.toEqual([{ id: 1 }])
    state.scan.mockResolvedValueOnce('nope')
    await expect(agentSessions.detect()).resolves.toEqual([])
    state.scan.mockRejectedValueOnce(new Error('x'))
    await expect(agentSessions.detect()).resolves.toEqual([])
    state.invoke.mockRejectedValue(new Error('x'))
    await expect(agentSessions.resolveClaudeSession('p', 'c', 5)).resolves.toBeNull()
    await expect(agentSessions.resolveModel('claude')).resolves.toBeNull()
    await expect(agentSessions.exportClaudeTranscript('p', 's')).resolves.toBeNull()
    state.invoke.mockResolvedValue(undefined)
    await agentSessions.loadStore()
    await agentSessions.saveStore({ a: 1 })
    expect(state.invoke).toHaveBeenCalledWith('agent_sessions_save', { document: { a: 1 } })
  })
})
