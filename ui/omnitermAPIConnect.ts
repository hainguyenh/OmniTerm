/**
 * The `connect` slice of `window.omnitermAPI`: local/SSH terminal streaming and the RDP window
 * lifecycle. Split out of omnitermAPI.ts to keep that file under its line limit — see the design
 * note there for what this bridge is and isn't.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { failSession, onSession, startSession, type ReplayMetadata } from './tauriSessions'
import { diag } from './diag'
import { sendInOrder } from './utils/sessionInputQueue'

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

export function createConnectAPI(): any {
  return {
    // Streaming lives in tauriSessions.ts: the ready/data/error/closed callbacks are held in a
    // local map and handed to the backend as IPC channels when the session starts.
    local: (sessionId: string, connId: string, overrideShell?: string, darkMode?: boolean) =>
      startSession(sessionId, connId, overrideShell, darkMode),
    localDisconnect: (id: string) =>
      invoke('disconnect_session', { id }).catch(() => {}),
    interruptSession: (id: string) => invoke<void>('interrupt_session', { id }),
    // In typing order: see sessionInputQueue.ts for why back-to-back sends could overtake each other.
    localInput: (id: string, data: string) =>
      sendInOrder(id, () => invoke('send_session_input', { id, data })),
    localResize: (id: string, size: { cols: number; rows: number }) =>
      invoke('resize_session', { id, cols: size.cols, rows: size.rows }).catch(() => {}),
    onLocalReady: (id: string, cb: (label?: string, replay?: ReplayMetadata) => void) => onSession(id, 'ready', cb),
    onLocalData: (id: string, cb: (data: Uint8Array) => void) => onSession(id, 'data', cb),
    onLocalError: (id: string, cb: (err: string) => void) => onSession(id, 'error', cb),
    onLocalClosed: (id: string, cb: (code: number) => void) => onSession(id, 'closed', cb),
    // Busy/idle: sessiond polls the PTY process tree and forwards activity on the existing channel.
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
    sshInput: (id: string, data: string) => { void sendInOrder(id, () => invoke('send_session_input', { id, data })) },
    sshResize: (id: string, size: { cols: number; rows: number }) => invoke('resize_session', { id, cols: size.cols, rows: size.rows }).catch(() => {}),
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
  }
}
