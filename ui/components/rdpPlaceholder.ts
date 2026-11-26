/** Where the session is, for the text shown until the client's window is docked over the pane. */
export type RdpPhase = 'starting' | 'signing-in' | 'docked' | 'closed' | 'error'

/** The pane text for each phase; a docked session is covered by the client window. */
export function rdpPlaceholderText(phase: RdpPhase, host: string): string {
  switch (phase) {
    case 'starting':
      return `Starting Remote Desktop for ${host}…`
    case 'signing-in':
      return `Connecting to ${host}. Sign in from the Remote Desktop prompt; the desktop appears here once it connects.`
    case 'docked':
      return ''
    case 'closed':
      return 'The Remote Desktop session has ended.'
    case 'error':
      return `Remote Desktop could not connect to ${host}.`
  }
}
