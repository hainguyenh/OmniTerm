/**
 * omnitermAPI.ts — the typed OmniTerm frontend API backed only by Tauri v2.
 *
 * Provides `window.omnitermAPI` from Tauri commands and events. This is the app's public frontend
 * boundary; it is not an Electron compatibility shim. The authoritative shape lives in
 * src/vite-env.d.ts.
 *
 * Design rule: this file forwards and adapts. It does not resolve connections, pick shells, or decide
 * what is safe — the backend does, because the webview is the untrusted side.
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { platform as osPlatform } from '@tauri-apps/plugin-os'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'
import { open } from '@tauri-apps/plugin-dialog'
import { homeDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { attachSession, failSession, onSession, startSession } from './tauriSessions'
import { diag } from './diag'
import { createAlwaysAwakeAPI } from '../plugins/always-awake/app/alwaysAwakeAPI'
import { createUpdateAPI } from './updateChecker'
import { createWorkspaceAPI } from './workspaceAPI'

/**
 * Subscribe to a Tauri event, returning a synchronous unsubscribe.
 *
 * Used for the app's genuinely broadcast events (`shell-open`, `maximized-state`) — per-session
 * traffic goes through IPC channels instead, see tauriSessions.ts.
 *
 * `listen` is async but every caller here is a React effect that must return its cleanup
 * synchronously. Unsubscribing before the listen resolves has to still take effect, or a component
 * that mounts and unmounts quickly (StrictMode's double-mount, a tab closed while connecting) leaks
 * the listener and its handler fires twice for the rest of the session.
 */
function onEvent<T>(eventName: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false
  listen<T>(eventName, (ev) => callback(ev.payload))
    .then((fn) => {
      if (cancelled) { fn(); return }
      unlisten = fn
    })
    .catch((e) => diag.error(`[omnitermAPI] failed to listen for ${eventName}`, e))
  return () => {
    cancelled = true
    unlisten?.()
    unlisten = null
  }
}

/** Window label prefix Rust mints for detached terminal windows (see terminal_window.rs). */
const DETACHED_LABEL_PREFIX = 'term-'

/**
 * A non-null marker when this webview is a detached terminal window.
 *
 * `App.tsx` reads this synchronously to pick its root view, so it cannot await anything — hence the
 * label, which Tauri injects into the webview at creation. The real session id is resolved a moment
 * later by `bootstrap()`, from the calling window's label, so a webview can only learn about itself.
 */
function detachedWindowMarker(): string | null {
  try {
    const label = getCurrentWindow().label
    return label.startsWith(DETACHED_LABEL_PREFIX) ? label : null
  } catch (e) {
    diag.warn('[omnitermAPI] could not read the window label', e)
    return null
  }
}

// ── Bridge implementation ────────────────────────────────────────────

function createTauriAPI(): any {
  let platformValue = 'unknown'
  try {
    const rawPlatform = osPlatform()
    if (rawPlatform === 'windows') platformValue = 'win32'
    else if (rawPlatform === 'macos') platformValue = 'darwin'
    else if (rawPlatform === 'linux') platformValue = 'linux'
  } catch (e) {
    diag.warn('[omnitermAPI] Failed to get OS platform', e)
  }

  // Real WebView zoom (`set_webview_zoom` → `WebviewWindow::set_zoom`) reflows the layout and stays
  // anchored, unlike a CSS `zoom` on <body>. Track the factor locally rather than re-reading it, and
  // fall back to the CSS property only if the native call is refused (e.g. zoom disabled by policy).
  let zoomFactor = 1

  const updates = createUpdateAPI(() => invoke<string>('get_version'))

  return {
    connections: {
      load: () => invoke('load_connections'),
      save: (data: unknown) => invoke('save_connections', { data }),
    },

    plugin: {
      available: () => invoke<boolean>('plugin_available').catch(() => false),
      list: () => invoke<any[]>('plugin_list').catch(() => []),
      setEnabled: (id: string, enabled: boolean) =>
        invoke<any>('plugin_set_enabled', { id, enabled }).catch(() => null),
      selectConnectionProvider: (id: string | null) =>
        invoke<any[]>('plugin_select_connection_provider', { id }),
      connectionCapabilities: () =>
        invoke<any>('connection_provider_capabilities').catch(() => null),
      // Keep plugin arguments as one typed Tauri command payload.
      invoke: (method: string, ...args: unknown[]) =>
        invoke<unknown>('plugin_invoke', { method, args }).catch(() => null),
      authGate: () => invoke<boolean>('plugin_auth_gate').catch(() => true),
      installPackage: () => invoke<any>('install_plugin_package'),
      remove: (id: string) => invoke<boolean>('remove_plugin', { id }),
      restartApp: () => invoke<void>('restart_app'),
    },

    alwaysAwake: createAlwaysAwakeAPI(),

    connect: {
      // Streaming lives in tauriSessions.ts: the ready/data/error/closed callbacks are held in a
      // local map and handed to the backend as IPC channels when the session starts.
      local: (sessionId: string, connId: string, overrideShell?: string, darkMode?: boolean) =>
        startSession(sessionId, connId, overrideShell, darkMode),
      localDisconnect: (id: string) =>
        invoke('disconnect_session', { id }).catch(() => {}),
      localInput: (id: string, data: string) =>
        invoke('send_session_input', { id, data }).catch(() => {}),
      localResize: (id: string, size: { cols: number; rows: number }) =>
        invoke('resize_session', { id, cols: size.cols, rows: size.rows }).catch(() => {}),
      onLocalReady: (id: string, cb: (label?: string) => void) => onSession(id, 'ready', cb),
      onLocalData: (id: string, cb: (data: Uint8Array) => void) => onSession(id, 'data', cb),
      onLocalError: (id: string, cb: (err: string) => void) => onSession(id, 'error', cb),
      onLocalClosed: (id: string, cb: (code: number) => void) => onSession(id, 'closed', cb),
      // Busy/idle: whether the shell has anything running under it (see src-tauri/src/proc_activity.rs).
      onLocalActivity: (id: string, cb: (busy: boolean) => void) => onSession(id, 'activity', cb),

      // Windows OpenSSH runs through the same ConPTY transport as local shells. Its password prompt
      // is therefore native to ssh.exe and no credential crosses the frontend API.
      ssh: async (id: string, darkMode?: boolean) => {
        try {
          await invoke('prepare_ssh_session', { connId: id })
          if (darkMode === undefined) await startSession(id, id, 'cmd')
          else await startSession(id, id, 'cmd', darkMode)
        } catch (error) {
          failSession(id, error instanceof Error ? error.message : String(error))
        }
      },
      sshDisconnect: (id: string) => { void invoke('disconnect_session', { id }).catch(() => {}) },
      sshInput: (id: string, data: string) => { void invoke('send_session_input', { id, data }).catch(() => {}) },
      sshResize: (id: string, size: { cols: number; rows: number }) => { void invoke('resize_session', { id, cols: size.cols, rows: size.rows }).catch(() => {}) },
      onSSHReady: (id: string, cb: () => void) => onSession(id, 'ready', () => cb()),
      onSSHData: (id: string, cb: (data: Uint8Array) => void) => onSession(id, 'data', cb),
      onSSHError: (id: string, cb: (err: string) => void) => onSession(id, 'error', cb),
      onSSHClosed: (id: string, cb: () => void) => onSession(id, 'closed', () => cb()),
      onSessionMetrics: (id: string, cb: (m: any) => void) =>
        onEvent<any>(`session-metrics-${id}`, cb),

      // The RDP client runs in its own window; `rdp-ready` / `rdp-error` / `rdp-closed` below report
      // its lifecycle. `{ ok: false }` on failure is what the renderer already handles.
      rdp: (id: string) =>
        invoke<{ ok: boolean }>('connect_rdp', { id })
          .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
      rdpDisconnect: (id: string) => { void invoke('rdp_disconnect', { id }).catch((e) => diag.error('[omnitermAPI] rdpDisconnect failed', e)) },
      rdpInput: (_id: string, _d: string) => {},
      rdpResize: (_id: string, _s: { cols: number; rows: number }) => {},
      // No-ops, and honestly so: the client is a separate top-level window, not embedded in a pane.
      // The backend commands these used to call had empty bodies, so the renderer believed it was
      // positioning something. Docking belongs to a plugin — see the note in src-tauri/src/rdp_embed.rs.
      rdpSetBounds: (..._args: unknown[]) => {},
      rdpSetVisible: (..._args: unknown[]) => {},
      rdpSetOverlay: (..._args: unknown[]) => {},
      rdpSetDetached: (..._args: unknown[]) => {},
      rdpResetTrust: (_h: string, _p?: string) => Promise.resolve(),
      onRDPDetachState: (_cb: (id: string, detached: boolean) => void) => () => {},
      overlayInit: () => Promise.resolve(null),
      onRDPLatency: (_id: string, _cb: (ms: number | null) => void) => () => {},
      onRDPReady: (id: string, cb: () => void) => onEvent<null>(`rdp-ready-${id}`, cb),
      onRDPError: (id: string, cb: (err: string) => void) => onEvent<string>(`rdp-error-${id}`, cb),
      onRDPClosed: (id: string, cb: () => void) => onEvent<null>(`rdp-closed-${id}`, cb),
    },

    // Detached terminal windows. A pane popped out here keeps running in Rust; only its output sink
    // moves between windows (see src-tauri/src/session_output.rs).
    terminalWindow: {
      // Truthy in a detached window, null in the main one. Derived from the window LABEL rather
      // than a URL parameter because `getCurrentWindow()` is synchronous: App.tsx has to choose its
      // root view before its first await. The session id itself arrives from `bootstrap()`.
      detachedSessionId: detachedWindowMarker(),
      detach: (payload: { sessionId: string; name: string; connection: any }) =>
        invoke<boolean>('detach_terminal', {
          sessionId: payload.sessionId,
          name: payload.name,
          connection: payload.connection,
        }).catch((e) => {
          diag.error('[omnitermAPI] detach failed', e)
          return false
        }),
      bootstrap: () =>
        invoke<any>('bootstrap_terminal_window').catch(() => null),
      // Replay + live subscription for a window binding to a running session. `data` comes back
      // empty on purpose: the scrollback is pushed down the data channel instead, so it reaches the
      // caller's already-registered onData handler rather than riding here as a JSON number array.
      resume: async (sessionId: string) => {
        const snapshot = await attachSession(sessionId)
        return snapshot ? { ...snapshot, data: new Uint8Array(0) } : null
      },
      reattach: (sessionId: string) =>
        invoke<boolean>('reattach_terminal', { id: sessionId }).catch(() => false),
      focus: (sessionId: string) => {
        void invoke('focus_terminal_window', { id: sessionId }).catch(() => {})
      },
      release: (sessionId: string) => {
        void invoke('release_terminal_window', { id: sessionId }).catch(() => {})
      },
      onReattached: (cb: (sessionId: string) => void) =>
        onEvent<string>('terminal-window-reattached', cb),
      // The detached window closed an idle session outright (no fold-back) — the session is gone.
      onClosed: (cb: (sessionId: string) => void) =>
        onEvent<string>('terminal-window-closed', cb),
    },

    clipboard: {
      writeText: (text: string) => writeText(text),
      readText: () => readText(),
    },

    // SFTP rides on SSH, so it arrives with it.
    sftp: {
      home: (_id: string) => Promise.resolve(''),
      list: (_id: string, _path: string) => Promise.resolve([]),
      realpath: (_id: string, _path: string) => Promise.resolve(''),
      mkdir: (_id: string, _path: string) => Promise.resolve(),
      rename: (_id: string, _from: string, _to: string) => Promise.resolve(),
      delete: (_id: string, _path: string) => Promise.resolve(),
      rmdirRecursive: (_id: string, _path: string) => Promise.resolve(),
      download: (_id: string, _remotePath: string, _suggestedName: string) => Promise.resolve(false),
      upload: (_id: string, _remoteDir: string) => Promise.resolve(0),
      onProgress: (_id: string, _cb: unknown) => (() => {}),
    },

    app: {
      platform: platformValue,
      revealLog: () => invoke<string>('reveal_log'),
      clearLog: () => invoke<boolean>('clear_log'),
      setZoomFactor: (factor: number) => {
        zoomFactor = factor
        invoke('set_webview_zoom', { factor }).catch(() => {
          document.body.style.zoom = String(factor)
        })
      },
      getZoomFactor: () => zoomFactor,
    },

    files: {
      // The renderer supplies the content; the backend owns the save dialog and the write, so a
      // filesystem path is never handed back into the webview.
      exportJson: ({ suggestedName, content }: { suggestedName: string; content: string }) =>
        invoke<boolean>('export_json', { suggestedName, content }),
      // Returns the chosen file's *contents*, never a filesystem path.
      importJson: () => invoke<string | null>('import_json'),
      // There is no encrypted-backup counterpart: the app stores no credential, so a backup has
      // nothing to protect. An encrypted file from an older build is rejected by the backend.
      importFile: () => invoke<any>('import_file'),
      getHomeDir: () => homeDir(),
      pickDirectory: async (defaultPath?: string) => {
        const selected = await open({ directory: true, multiple: false, defaultPath })
        return typeof selected === 'string' ? selected : null
      },
    },

    customArt: {
      // The backend opens a file picker, validates the image, and stores it in custom-art/.
      // A cache-busting query param is appended so the webview always fetches the latest file
      // when the user replaces art for the same slot (the path stays the same).
      upload: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') =>
        open({
          multiple: false,
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
        }).then((path) =>
          typeof path === 'string'
            ? invoke<string>('upload_custom_art', { slot, path }).then(p => `${convertFileSrc(p)}?t=${Date.now()}`)
            : Promise.reject(new Error('cancelled')),
        ),
      get: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') => invoke<string | null>('get_custom_art', { slot }).then(p => p ? `${convertFileSrc(p)}?t=${Date.now()}` : null),
      remove: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') => invoke<void>('remove_custom_art', { slot }),
    },

    settings: {
      get: () => invoke<any>('get_settings'),
      // A partial object is a partial write — the backend merges it into what is stored.
      save: (settings: any) => invoke('save_settings', { settings }),
      // The backend broadcasts this after every successful save from ANY window, so a popped-out
      // terminal and the main window keep their appearance state in sync while one is detached.
      onChanged: (cb: (settings: any) => void) => onEvent<any>('settings:changed', cb),
      // The fixed half of the viewer's deny-list (safepath::VIEW_DENY_EXTS) — shown locked in
      // GeneralSettings.tsx alongside the user's own `excludedViewableExts`, so the setting can never
      // claim to unhide something the app itself refuses to open.
      systemExcludedViewExts: () => invoke<string[]>('system_excluded_view_exts'),
    },

    workspace: createWorkspaceAPI(),

    updates,

    themes: {
      list: () => invoke('list_themes'),
      openFolder: () => invoke('open_themes_folder'),
      save: (theme: unknown) => invoke('save_theme', { theme }),
      delete: (id: string) => invoke('delete_theme', { id }),
    },

    windowControl: {
      minimize: () => invoke('minimize_window'),
      toggleMaximize: () => invoke('toggle_maximize'),
      close: () => invoke('close_window'),
      isMaximized: () => invoke<boolean>('is_maximized'),
      onMaximizedState: (cb: (state: boolean) => void) => onEvent<boolean>('maximized-state', cb),
    },

    shells: {
      // Tells the backend the renderer can receive `shell-open`, flushing anything queued while the
      // app was locked or cold-starting. Also writes the launcher shims.
      ready: () => {
        void invoke('setup_launcher').catch((e) =>
          diag.warn('[omnitermAPI] could not write launcher shims', e),
        )
        void invoke('shells_ready').catch((e) =>
          diag.error('[omnitermAPI] shells_ready failed', e),
        )
      },
      release: (connId: string) => {
        void invoke('shells_release', { connId }).catch(() => {})
      },
      // Registers an unsaved shell ("new session") and returns the Connection record to open a pane
      // with — the id it carries is one the backend can resolve, which a renderer-invented id is not.
      // The shell name is validated against the closed set there, not here.
      open: (shell?: string, workspaceId?: string | null) => invoke<any>('open_quick_shell', { shell: shell ?? null, workspaceId: workspaceId ?? null }),
      // The shells this machine can really start. Probed in the backend, next to the code that
      // resolves each one to an executable — the renderer has no way to know what is installed.
      list: () => invoke<Array<{ id: string; label: string }>>('list_available_shells'),
      onOpen: (cb: (conn: any) => void) => onEvent<any>('shell-open', cb),
    },
  } as any
}

export function initTauriBridge(): void {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      (window as any).omnitermAPI = createTauriAPI()
      diag.log('[omnitermAPI] Bridge initialized — running in Tauri')
    } catch (e) {
      diag.error('[omnitermAPI] Failed to initialize bridge:', e)
    }
  }
}

/** Exported for tests: builds the bridge object without touching `window`. */
export const __createTauriAPIForTests = createTauriAPI
