/**
 * Channel adapter for a terminal pane.
 *
 * SSH sessions talk to the `ssh:*` IPC, LOCAL (WSL/PowerShell/CMD) sessions to the `local:*` ConPTY
 * IPC. The two have the same streaming shape, so every consumer above this line is identical — which
 * is the whole point of the adapter: `TerminalView` wires one object and never branches on the
 * connection type again.
 *
 * Metrics and busy/idle are deliberately NOT here. They are each one-sided (metrics are SSH-only
 * because a local shell has no remote host to measure; activity is local-only because it is the
 * host's own process tree being watched), so folding them in would mean two no-op members on every
 * adapter and a reader having to check which half is real.
 */

export interface SessionChannel {
  connect: () => void
  input: (data: string) => void
  resize: (size: { cols: number; rows: number }) => void
  /** Each `on*` returns a synchronous unsubscribe — see omnitermAPI.ts. */
  onReady: (cb: (label?: string) => void) => () => void
  onData: (cb: (data: Uint8Array) => void) => () => void
  onError: (cb: (err: string) => void) => () => void
  onClosed: (cb: (code?: number) => void) => () => void
}

/**
 * @param id      This pane instance's session key, unique per tab.
 * @param connId  The saved connection whose settings the session loads. It diverges from `id` when
 *                the same LOCAL connection is running as more than one independent instance (see
 *                MainLayout's activeTabs).
 */
export const createSessionChannel = (
  isLocal: boolean,
  id: string,
  connId: string,
  shell?: string,
  darkMode?: boolean,
): SessionChannel => (isLocal
  ? {
      connect: () => darkMode === undefined
        ? window.omnitermAPI.connect.local(id, connId, shell)
        : window.omnitermAPI.connect.local(id, connId, shell, darkMode),
      input: (d) => window.omnitermAPI.connect.localInput(id, d),
      resize: (s) => window.omnitermAPI.connect.localResize(id, s),
      onReady: (cb) => window.omnitermAPI.connect.onLocalReady(id, cb),
      onData: (cb) => window.omnitermAPI.connect.onLocalData(id, cb),
      onError: (cb) => window.omnitermAPI.connect.onLocalError(id, cb),
      onClosed: (cb) => window.omnitermAPI.connect.onLocalClosed(id, cb),
    }
  : {
      connect: () => darkMode === undefined
        ? window.omnitermAPI.connect.ssh(id)
        : window.omnitermAPI.connect.ssh(id, darkMode),
      input: (d) => window.omnitermAPI.connect.sshInput(id, d),
      resize: (s) => window.omnitermAPI.connect.sshResize(id, s),
      onReady: (cb) => window.omnitermAPI.connect.onSSHReady(id, () => cb()),
      onData: (cb) => window.omnitermAPI.connect.onSSHData(id, cb),
      onError: (cb) => window.omnitermAPI.connect.onSSHError(id, cb),
      // SSH reports no status of its own, so a closed channel is reported as a clean exit.
      onClosed: (cb) => window.omnitermAPI.connect.onSSHClosed(id, () => cb(0)),
    })
