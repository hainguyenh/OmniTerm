/**
 * The `connect` slice of `window.omnitermAPI`: local/SSH terminal streaming and the RDP window
 * lifecycle. Split out of omnitermAPI.ts to keep that file under its line limit — see the design
 * note there for what this bridge is and isn't.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { failSession, onSession, startSession, type ReplayMetadata } from './tauriSessions'
import { ackSessionOutput } from './sessionOutputAck'
import { diag } from './diag'
import { sendInOrder } from './utils/sessionInputQueue'

/** An RDP pane's rectangle in CSS pixels, with the device pixel ratio that converts it. */
interface RdpPaneBounds {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

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
    onLocalData: (id: string, cb: (data: Uint8Array) => 'ack-later' | void) => onSession(id, 'data', cb),
    onLocalError: (id: string, cb: (err: string) => void) => onSession(id, 'error', cb),
    // A pane whose data handler returned 'ack-later' reports here what it wrote (sessionOutputAck.ts).
    ackOutput: (id: string, bytes: number) => ackSessionOutput(id, bytes),
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
    onSSHData: (id: string, cb: (data: Uint8Array) => 'ack-later' | void) => onSession(id, 'data', cb),
    onSSHError: (id: string, cb: (err: string) => void) => onSession(id, 'error', cb),
    // ssh.exe's own exit code: 255 when it could not connect or log in, so the tab stays with its error.
    onSSHClosed: (id: string, cb: (code: number) => void) => onSession(id, 'closed', cb),
    onSessionMetrics: (id: string, cb: (m: any) => void) =>
      onEvent<any>(`session-metrics-${id}`, cb),

    // The system RDP client is launched by the host, which docks its session window into the pane
    // reported through `rdpSetBounds` (Windows). `rdp-ready` / `rdp-docked` / `rdp-error` /
    // `rdp-closed` report its lifecycle. `{ ok: false }` on failure is what the renderer handles.
    rdp: (id: string, bounds?: RdpPaneBounds) =>
      invoke<{ ok: boolean }>('connect_rdp', { id, bounds: bounds ?? null })
        .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
    rdpDisconnect: (id: string) => { void invoke('rdp_disconnect', { id }).catch((e) => diag.error('[omnitermAPI] rdpDisconnect failed', e)) },
    rdpInput: (_id: string, _d: string) => {},
    rdpResize: (_id: string, _s: { cols: number; rows: number }) => {},
    rdpSetBounds: (id: string, bounds: RdpPaneBounds) => {
      void invoke('rdp_set_bounds', { id, bounds }).catch((e) => diag.error('[omnitermAPI] rdpSetBounds failed', e))
    },
    rdpSetVisible: (id: string, visible: boolean) => {
      void invoke('rdp_set_visible', { id, visible }).catch((e) => diag.error('[omnitermAPI] rdpSetVisible failed', e))
    },
    rdpSetOverlay: (..._args: unknown[]) => {},
    rdpSetDetached: (..._args: unknown[]) => {},
    rdpResetTrust: (_h: string, _p?: string) => Promise.resolve(),
    onRDPDetachState: (_cb: (id: string, detached: boolean) => void) => () => {},
    overlayInit: () => Promise.resolve(null),
    onRDPLatency: (_id: string, _cb: (ms: number | null) => void) => () => {},
    onRDPReady: (id: string, cb: () => void) => onEvent<null>(`rdp-ready-${id}`, cb),
    onRDPDocked: (id: string, cb: () => void) => onEvent<null>(`rdp-docked-${id}`, cb),
    onRDPError: (id: string, cb: (err: string) => void) => onEvent<string>(`rdp-error-${id}`, cb),
    onRDPClosed: (id: string, cb: () => void) => onEvent<null>(`rdp-closed-${id}`, cb),
  }
}
