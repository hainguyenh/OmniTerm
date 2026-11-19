/** Normalises a folder path to forward slashes without a trailing slash, as repository roots are. */
export function normalizeDir(path: string): string {
  const slashed = path.replace(/[\\]/g, '/')
  return slashed.length > 1 && slashed.endsWith('/') ? slashed.slice(0, -1) : slashed
}

/** Which folder the footer's Git widget describes, by what is in front of the user. */
export interface FooterContext {
  /** The active editor tab's file, when an editor tab is active. */
  editorPath: string | null
  /** An active session tab: where its agent started, else where its shell is now. */
  session: { launchCwd?: string; cwd?: string } | null
  /** The default (selected) project's folder. */
  defaultFolder: string | null
}

/** The path whose repository the footer shows: the session's folder, else the file, else the default project. */
export function footerContextPath(context: FooterContext): string | null {
  if (context.session) return context.session.launchCwd ?? context.session.cwd ?? context.defaultFolder
  return context.editorPath ?? context.defaultFolder
}

/** The innermost of `roots` holding `path`; Windows paths compare case-insensitively. */
export function rootContaining(path: string, roots: readonly string[]): string | null {
  const target = normalizeDir(path).toLowerCase()
  let best: string | null = null
  for (const root of roots) {
    const at = normalizeDir(root).toLowerCase()
    if ((target === at || target.startsWith(`${at}/`)) && (!best || root.length > best.length)) best = root
  }
  return best
}
