import type { Terminal } from '@xterm/xterm'

/**
 * Shell-reported working directory reporting for one pane.
 *
 * OSC 7 is the standards-track form (`file://host/path`); Windows shells and pwsh emit the
 * OSC 9;9 notification instead. Both feed `onCwdChange`; shells that emit neither simply never
 * set a cwd label.
 */
/**
 * The directory a shell reported, as a path the rest of the app (and Claude's project-folder
 * encoding) can use. OSC 7 on Windows arrives as `file://host/C:/repo`; dropping only the scheme
 * and host leaves `/C:/repo`, which encodes to `-C--repo` instead of Claude's `C--repo`, so the
 * session file of a pane that had `cd`-ed was never found. A malformed escape is taken verbatim.
 */
export const normalizeReportedCwd = (rawPath: string): string => {
  let decoded = rawPath
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    // Not percent-encoded after all (a literal `%` in a folder name).
  }
  const cleaned = decoded.trim()
  const withoutScheme = cleaned.startsWith('file://')
    ? cleaned.replace(/^file:\/\/[^/]*/, '')
    : cleaned
  return withoutScheme.replace(/^\/([A-Za-z]:(?:[\\/]|$))/, '$1')
}

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
    if (!rawPath.trim()) return true
    const cwd = normalizeReportedCwd(rawPath)
    if (cwd) onCwdChange(cwd)
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
