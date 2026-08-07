/**
 * @vitest-environment jsdom
 *
 * Contract tests for the Tauri ↔ omnitermAPI bridge: files, workspace, shells, settings, plugins.
 *
 * Session and event-subscription behavior lives in tauriBridge.test.ts.
 *
 * Every bug this suite pins was a silent one: a command name or argument key that did not match the
 * Rust `#[tauri::command]` signature fails at runtime with "invalid args" or "command not found", and
 * several of those calls swallow their own rejections. Asserting the exact `invoke` payload is the
 * only way to catch that without launching the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const emitMock = vi.fn()
const openMock = vi.fn()
const writeTextMock = vi.fn()
const readTextMock = vi.fn()
const homeDirMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  // Session streaming is covered in tauriBridge.test.ts; nothing here creates a channel.
  Channel: class {},
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
  emit: (...args: unknown[]) => emitMock(...args),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
  readText: (...args: unknown[]) => readTextMock(...args),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openMock(...args) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: '' }) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: (...args: unknown[]) => homeDirMock(...args) }))

const { __createTauriAPIForTests } = await import('../omnitermAPI')

/** The last `invoke` call as `[command, args]`. */
function lastInvoke(): [string, Record<string, unknown>] {
  const call = invokeMock.mock.calls.at(-1)
  if (!call) throw new Error('invoke was never called')
  return [call[0] as string, (call[1] ?? {}) as Record<string, unknown>]
}

function invokedCommands(): string[] {
  return invokeMock.mock.calls.map((c) => c[0] as string)
}

let api: any

beforeEach(() => {
  vi.clearAllMocks()
  invokeMock.mockResolvedValue(undefined)
  emitMock.mockResolvedValue(undefined)
  listenMock.mockResolvedValue(() => {})
  api = __createTauriAPIForTests()
})

// ── Files: import / export ───────────────────────────────────────────

describe('files', () => {
  /** Electron's signature is `exportJson({ suggestedName, content })` and it returns a boolean. */
  it('exports JSON by handing the content to the backend', async () => {
    invokeMock.mockResolvedValueOnce(true)
    const ok = await api.files.exportJson({ suggestedName: 'connections.json', content: '{"a":1}' })
    expect(ok).toBe(true)
    expect(lastInvoke()).toEqual([
      'export_json',
      { suggestedName: 'connections.json', content: '{"a":1}' },
    ])
  })

  it('returns the imported file contents, not a path', async () => {
    invokeMock.mockResolvedValueOnce('{"folders":[],"connections":[]}')
    const result = await api.files.importJson()
    expect(lastInvoke()[0]).toBe('import_json')
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('passes a plain import result through untouched', async () => {
    const backend = { folders: [{ id: 'f', name: 'Prod' }], connections: [] }
    invokeMock.mockResolvedValueOnce(backend)
    await expect(api.files.importFile()).resolves.toEqual(backend)
    expect(lastInvoke()[0]).toBe('import_file')
  })

  /**
   * P1: the bridge is the last place a credential could cross into the webview, so it must expose no
   * route for one. There is deliberately no `exportEncrypted`, no `decryptImport`, and no
   * `sshSendPassword` — an encrypted backup is refused in Rust, with a migration message.
   */
  it('exposes no credential-carrying commands at all', () => {
    expect(api.files.exportEncrypted).toBeUndefined()
    expect(api.files.decryptImport).toBeUndefined()
    expect(api.connect.sshSendPassword).toBeUndefined()
  })

  it('resolves the home directory and a picked folder', async () => {
    homeDirMock.mockResolvedValueOnce('C:/Users/me')
    await expect(api.files.getHomeDir()).resolves.toBe('C:/Users/me')

    openMock.mockResolvedValueOnce('C:/proj')
    await expect(api.files.pickDirectory('C:/')).resolves.toBe('C:/proj')
    expect(openMock).toHaveBeenCalledWith({
      directory: true, multiple: false, defaultPath: 'C:/',
    })

    // A cancelled picker is null, not the dialog's own falsy value.
    openMock.mockResolvedValueOnce(null)
    await expect(api.files.pickDirectory()).resolves.toBeNull()
  })
})

// ── Workspace ────────────────────────────────────────────────────────

describe('workspace', () => {
  /**
   * The backend builds the shell + command for the script's kind and re-checks that the path is inside
   * the workspace. The first port assembled the launch in the webview and emitted `shell-open`
   * directly, skipping both — and put the script path in the `shell` slot.
   */
  it('delegates a script run to the backend instead of emitting shell-open', async () => {
    invokeMock.mockResolvedValueOnce(true)
    const script = { id: 'deploy.bat', name: 'deploy.bat', path: 'C:/proj/deploy.bat', kind: 'bat' }
    await api.workspace.run({ workspaceId: 'ws#1', script })

    expect(lastInvoke()).toEqual([
      'run_script',
      { workspaceId: 'ws#1', script, subPath: null },
    ])
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('passes a subPath through for "open a terminal here"', async () => {
    invokeMock.mockResolvedValueOnce(true)
    await api.workspace.run({ workspaceId: 'ws#1', subPath: 'packages/app' })
    expect(lastInvoke()[1]).toEqual({
      workspaceId: 'ws#1', script: null, subPath: 'packages/app',
    })
  })

  /** The workspace id is what scopes the path check; dropping it would defeat the containment guard. */
  it('sends the workspace id with every script read and write', async () => {
    invokeMock.mockResolvedValueOnce('echo hi')
    await api.workspace.readScript('ws#1', 'C:/proj/deploy.bat')
    expect(lastInvoke()).toEqual([
      'read_script', { workspaceId: 'ws#1', path: 'C:/proj/deploy.bat' },
    ])

    await api.workspace.writeScript('ws#1', 'C:/proj/deploy.bat', 'echo bye')
    expect(lastInvoke()).toEqual([
      'write_script',
      { workspaceId: 'ws#1', path: 'C:/proj/deploy.bat', content: 'echo bye' },
    ])
  })

  it('adds a workspace only after the user picks a folder', async () => {
    openMock.mockResolvedValueOnce('C:/proj')
    invokeMock.mockResolvedValueOnce({ id: 'ws#1', name: 'proj', path: 'C:/proj' })
    await api.workspace.add()
    expect(lastInvoke()).toEqual(['add_workspace', { path: 'C:/proj' }])

    invokeMock.mockClear()
    openMock.mockResolvedValueOnce(null)
    await expect(api.workspace.add()).resolves.toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('scans with the workspace id the backend expects', async () => {
    invokeMock.mockResolvedValueOnce([])
    await api.workspace.scanScripts('ws#1')
    expect(lastInvoke()).toEqual(['scan_scripts', { workspaceId: 'ws#1' }])
  })
})

// ── Shells / launcher ────────────────────────────────────────────────

describe('shells', () => {
  it('writes the launcher shims and flushes queued opens on ready', async () => {
    api.shells.ready()
    await Promise.resolve()
    expect(invokedCommands()).toEqual(expect.arrayContaining(['setup_launcher', 'shells_ready']))
  })

  it('releases an ad-hoc connection by id', async () => {
    api.shells.release('adhoc-1')
    await Promise.resolve()
    expect(lastInvoke()).toEqual(['shells_release', { connId: 'adhoc-1' }])
  })

  /**
   * "New session" has no saved connection, so the backend registers the shell and hands back the
   * record to open. The renderer used to invent a `local-default-<ts>` id, which resolved to nothing
   * there — the pane reported `Unknown connection` and never connected.
   */
  it('registers an unsaved shell and returns its connection record', async () => {
    const record = { id: 'adhoc-9', name: 'PowerShell', type: 'LOCAL', shell: 'powershell' }
    invokeMock.mockResolvedValueOnce(record)
    await expect(api.shells.open('powershell')).resolves.toEqual(record)
    expect(lastInvoke()).toEqual(['open_quick_shell', { shell: 'powershell' }])
  })

  it('asks for the platform default when no shell is named', async () => {
    invokeMock.mockResolvedValueOnce(null)
    await api.shells.open()
    expect(lastInvoke()).toEqual(['open_quick_shell', { shell: null }])
  })

  /** The picker's contents are probed in the backend — the renderer cannot know what is installed. */
  it('lists the shells this machine can start', async () => {
    const options = [{ id: 'powershell', label: 'PowerShell 7' }, { id: 'cmd', label: 'Command Prompt' }]
    invokeMock.mockResolvedValueOnce(options)
    await expect(api.shells.list()).resolves.toEqual(options)
    expect(lastInvoke()).toEqual(['list_available_shells', {}])
  })
})

// ── Settings, plugin, misc ───────────────────────────────────────────

describe('settings and plugins', () => {
  /** A partial object must reach the backend as-is; it merges rather than replaces. */
  it('sends settings as a partial patch', async () => {
    await api.settings.save({ fontSize: 18 })
    expect(lastInvoke()).toEqual(['save_settings', { settings: { fontSize: 18 } }])
  })

  it('invokes a plugin method with its args collected into an array', async () => {
    invokeMock.mockResolvedValueOnce(null)
    await api.plugin.invoke('vault.list', 'a', 2)
    expect(lastInvoke()).toEqual(['plugin_invoke', { method: 'vault.list', args: ['a', 2] }])
  })

  it('degrades to safe values when a plugin command fails', async () => {
    invokeMock.mockRejectedValue('no host')
    await expect(api.plugin.available()).resolves.toBe(false)
    await expect(api.plugin.list()).resolves.toEqual([])
    await expect(api.plugin.authGate()).resolves.toBe(true)
    await expect(api.plugin.invoke('x')).resolves.toBeNull()
  })

  it('forwards theme and window-control calls with matching argument names', async () => {
    await api.themes.save({ id: 'mine' })
    expect(lastInvoke()).toEqual(['save_theme', { theme: { id: 'mine' } }])
    await api.themes.delete('mine')
    expect(lastInvoke()).toEqual(['delete_theme', { id: 'mine' }])
    await api.windowControl.toggleMaximize()
    expect(lastInvoke()[0]).toBe('toggle_maximize')
  })

  it('forwards connection load and save', async () => {
    invokeMock.mockResolvedValueOnce({ connections: [], folders: [] })
    await api.connections.load()
    expect(lastInvoke()[0]).toBe('load_connections')

    const tree = { connections: [], folders: [] }
    await api.connections.save(tree)
    expect(lastInvoke()).toEqual(['save_connections', { data: tree }])
  })

  it('reads the version through the backend', async () => {
    invokeMock.mockResolvedValueOnce('0.1.0')
    await expect(api.updates.getVersion()).resolves.toBe('0.1.0')

  })

  it('round-trips the zoom factor it was given, through the native webview zoom command', () => {
    expect(api.app.getZoomFactor()).toBe(1)
    api.app.setZoomFactor(1.25)
    expect(api.app.getZoomFactor()).toBe(1.25)
    expect(lastInvoke()).toEqual(['set_webview_zoom', { factor: 1.25 }])
  })

  it('falls back to CSS zoom if the native call is refused', async () => {
    invokeMock.mockRejectedValueOnce(new Error('zoom disabled by policy'))
    api.app.setZoomFactor(0.8)
    await Promise.resolve().then(() => Promise.resolve())
    expect(document.body.style.zoom).toBe('0.8')
  })

  it('uses the clipboard plugin directly', async () => {
    await api.clipboard.writeText('hi')
    expect(writeTextMock).toHaveBeenCalledWith('hi')
    readTextMock.mockResolvedValueOnce('hi')
    await expect(api.clipboard.readText()).resolves.toBe('hi')
  })
})
