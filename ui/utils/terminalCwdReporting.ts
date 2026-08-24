import type { Terminal } from '@xterm/xterm'

/**
 * Shell-reported working directory reporting for one pane.
 *
 * OSC 7 is the standards-track form (`file://host/path`); Windows shells and pwsh emit the
 * OSC 9;9 notification instead. Both feed `onCwdChange`; shells that emit neither simply never
 * set a cwd label.
 */
export const registerCwdReporting = (
  term: Terminal,
  onCwdChange?: (cwd: string) => void,
): Array<{ dispose: () => void }> => {
  const disposables: Array<{ dispose: () => void }> = []
  const parser = (term as unknown as {
    parser?: {
      registerOscHandler?: (
        ident: number,
        callback: (data: string) => boolean | Promise<boolean>,
      ) => { dispose: () => void }
    }
  }).parser
  if (!parser?.registerOscHandler || !onCwdChange) return disposables

  const report = (rawPath: string) => {
    const cleaned = decodeURIComponent(rawPath).trim()
    if (!cleaned) return true
    const withoutScheme = cleaned.startsWith('file://')
      ? cleaned.replace(/^file:\/\/[^/]*/, '')
      : cleaned
    if (withoutScheme) onCwdChange(withoutScheme)
    return false
  }
  const osc7 = parser.registerOscHandler(7, data => report(data))
  // ConEmu/Windows style CWD notification: ESC ] 9 ; 9 ; "path" ESC \ — the handler for ident 9
  // receives everything after the first `9;`.
  const osc999 = parser.registerOscHandler(9, data =>
    data.startsWith('9;') ? report(data.slice(2).replace(/^"|"$/g, '')) : false,
  )
  disposables.push(osc7, osc999)
  return disposables
}
