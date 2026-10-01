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
import { writeText, readText, readImage } from '@tauri-apps/plugin-clipboard-manager'
import { open } from '@tauri-apps/plugin-dialog'
import { homeDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { attachSession } from './tauriSessions'
import { diag } from './diag'
import { createAgentQuotaAPI } from '../plugins/agent-quota/app/agentQuotaAPI'
import { createAlwaysAwakeAPI } from '../plugins/always-awake/app/alwaysAwakeAPI'
import { createUpdateAPI } from './updateChecker'
import { createWorkspaceAPI } from './workspaceAPI'
import { createConnectAPI } from './omnitermAPIConnect'
import { parseAttachmentInfo, parseAttachmentList, parseAttachmentListing, parseClearReport } from './utils/attachmentTypes'
import type { DetachedContextUpdate } from './utils/sessionRecoveryTypes'
import type { DetectedPaneAgent } from './utils/agentSessionDetector'

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

  const updates = {
    ...createUpdateAPI(() => invoke<string>('get_version')),
    // Native signed-update path (tauri-plugin-updater). Absent config in dev builds resolves to
    // `{ available: false, reason: 'updater-disabled' }` instead of an error.
    nativeCheck: () => invoke<{ available: boolean; reason?: string; version?: string }>('check_for_native_update'),
    nativeInstall: () => invoke<void>('download_and_install_update'),
  }

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
    agentQuota: createAgentQuotaAPI(),

    connect: createConnectAPI(),

    // Detached terminal windows are disposable daemon clients; PTYs stay owned by sessiond.
    terminalWindow: {
      // Derived from the synchronous window label so App.tsx can choose the detached root early.
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
      // Replay rides the already-registered data channel; the returned data field stays empty.
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
      onClosed: (cb: (sessionId: string) => void) =>
        onEvent<string>('terminal-window-closed', cb),
      reportContext: (sessionId: string, update: Omit<DetachedContextUpdate, 'sessionId'>) =>
        invoke<void>('report_detached_terminal_context', {
          sessionId,
          cwd: update.cwd ?? null,
          title: update.title ?? null,
        }).catch((error) => diag.warn('[omnitermAPI] detached context report failed', error)),
      onContext: (cb: (update: DetachedContextUpdate) => void) => onEvent<DetachedContextUpdate>('terminal-window-context', cb),
    },

    clipboard: {
      writeText: (text: string) => writeText(text),
      readText: () => readText(),
      // Native RGBA read for image paste. WebView2 denies `navigator.clipboard.read()` by
      // default, so the plugin is the reliable path; no image on the clipboard resolves null.
      readImage: async () => {
        try {
          const image = await readImage()
          const [rgba, size] = await Promise.all([image.rgba(), image.size()])
          void image.close?.()
          return { rgba, width: size.width, height: size.height }
        } catch {
          return null
        }
      },
      saveImageTemp: (bytes: Uint8Array, sessionId?: string) =>
        invoke<string>('save_temp_image', { bytes, sessionId }),
    },

    // Raw-body upload so a large file is not serialized as a JSON number array; the name is a hint.
    attachments: {
      save: (name: string, bytes: Uint8Array, sessionId?: string) =>
        invoke<unknown>('save_attachment', bytes, {
          headers: {
            'x-omniterm-attachment-name': encodeURIComponent(name),
            ...(sessionId ? { 'x-omniterm-session-id': encodeURIComponent(sessionId) } : {}),
          },
        }).then(parseAttachmentInfo),
      importClipboardFiles: (sessionId?: string) =>
        invoke<unknown>('import_clipboard_files', { sessionId }).then(parseAttachmentList, () => []),
      list: (sessionId?: string) =>
        invoke<unknown>('list_attachments', { sessionId }).then(parseAttachmentListing),
      clear: (sessionId?: string) =>
        invoke<unknown>('clear_attachments', { sessionId }).then(parseClearReport),
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
      // Open a local file or directory with the OS's default handler (Explorer/Finder/xdg-open).
      // URL inputs are refused by the backend (validate_path_for_open); the renderer routes URLs
      // through the link/path overlay menu's "Open Link" item (TerminalViewLinkMenuHost.openUrl).
      openInSystem: (path: string) =>
        invoke<void>('open_in_system', { path }).catch((e) => {
          diag.warn('[omnitermAPI] open_in_system failed', e)
        }),
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
      exportText: (opts: { suggestedName: string; content: string }) => invoke<boolean>('export_text', opts),
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
      upload: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark' | 'session-light' | 'session-dark' | `pace-${'slow' | 'onTrack' | 'fast' | 'overshooting'}-${'light' | 'dark'}`) =>
        open({
          multiple: false,
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
        }).then((path) =>
          typeof path === 'string'
            ? invoke<string>('upload_custom_art', { slot, path }).then(p => `${convertFileSrc(p)}?t=${Date.now()}`)
            : Promise.reject(new Error('cancelled')),
        ),
      get: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark' | 'session-light' | 'session-dark' | `pace-${'slow' | 'onTrack' | 'fast' | 'overshooting'}-${'light' | 'dark'}`) => invoke<string | null>('get_custom_art', { slot }).then(p => p ? `${convertFileSrc(p)}?t=${Date.now()}` : null),
      remove: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark' | 'session-light' | 'session-dark' | `pace-${'slow' | 'onTrack' | 'fast' | 'overshooting'}-${'light' | 'dark'}`) => invoke<void>('remove_custom_art', { slot }),
    },

    settings: {
      get: () => invoke<any>('get_settings'),
      // A partial object is a partial write — the backend merges it into what is stored.
      save: (settings: any) => invoke('save_settings', { settings }),
      /** Versioned envelope { version, exportedAt, sections }; secrets never leave the stores. */
      exportAll: () => invoke<SettingsTransferEnvelope>('export_settings'),
      importAll: (envelope: SettingsTransferEnvelope, strategy: 'merge' | 'replace') =>
        invoke<{ imported: Record<string, number> }>('import_settings', { envelope, strategy }),
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
      setFullscreen: (on: boolean) => invoke('set_fullscreen', { on }),
      onMaximizedState: (cb: (state: boolean) => void) => onEvent<boolean>('maximized-state', cb),
    },

    shells: {
      // Tells the backend the renderer can receive `shell-open`, flushing anything queued while the
      // app was locked or cold-starting. Also writes the launcher shims.
      ready: () => {
        void invoke('setup_launcher').catch((e) => diag.warn('[omnitermAPI] could not write launcher shims', e))
        void invoke('shells_ready').catch((e) => diag.error('[omnitermAPI] shells_ready failed', e))
      },
      release: (connId: string) => {
        void invoke('shells_release', { connId }).catch(() => {})
      },
      // Registers an unsaved shell ("new session") and returns the Connection record to open a pane
      // with — the id it carries is one the backend can resolve, which a renderer-invented id is not.
      // The shell name is validated against the closed set there, not here.
      open: (shell?: string, workspaceId?: string | null, folderId?: string | null, cwd?: string | null, command?: string | null) => invoke<any>('open_quick_shell', {
        shell: shell ?? null,
        workspaceId: workspaceId ?? null,
        ...(folderId ? { folderId } : {}),
        ...(cwd ? { cwd } : {}),
        ...(command ? { command } : {}),
      }),
      // The shells this machine can really start. Probed in the backend, next to the code that
      // resolves each one to an executable — the renderer has no way to know what is installed.
      list: () => invoke<Array<{ id: string; label: string }>>('list_available_shells'),
      onOpen: (cb: (conn: any) => void) => onEvent<any>('shell-open', cb),
    },
    // Which AI agent (if any) runs under each local pane's shell, from the process tree — not from
    // terminal output or a renderer-supplied guess. Shared with the Agent Quota plugin, which is why
    // this command is always registered, whether or not that plugin is enabled.
    agentSessions: {
      detect: () => invoke<DetectedPaneAgent[]>('agent_quota_detect').catch(() => []),
      resolveClaudeSession: (profileDir: string, cwd: string, sinceEpochSecs?: number) =>
        invoke<string | null>('resolve_claude_session', { profileDir, cwd, sinceEpochSecs }).catch(() => null),
      // Only on an explicit Save: the rendered conversation goes to the file the user picks.
      exportClaudeTranscript: (profileDir: string, sessionId: string) =>
        invoke<string>('export_claude_transcript', { profileDir, sessionId }).catch(() => null),
      // Crash-safe copy of stored sessions/bookmarks in app data (see ui/utils/agentSessionDurable.ts).
      loadStore: () => invoke<unknown>('agent_sessions_load'),
      saveStore: (document: Record<string, unknown>) => invoke<void>('agent_sessions_save', { document }),
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
