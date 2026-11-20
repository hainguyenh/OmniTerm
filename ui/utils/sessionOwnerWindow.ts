import { getCurrentWindow } from '@tauri-apps/api/window'

/** The window that owns the persisted session layout: restores it on launch and writes it back. */
const SESSION_OWNER_LABEL = 'main'

/**
 * Whether this webview owns terminal-session persistence.
 *
 * The saved layout lives in storage shared by every window of the app, and restoring it kills and
 * recreates the daemon session under each saved tab id. A second project window (`project-*`) that
 * restored it would therefore tear the main window's live shells down and overwrite its snapshot, so
 * only `main` may. Outside Tauri (tests, plain browser) there is a single page, which owns it.
 */
export function ownsSessionPersistence(label?: string): boolean {
  if (label !== undefined) return label === SESSION_OWNER_LABEL
  try {
    return getCurrentWindow().label === SESSION_OWNER_LABEL
  } catch {
    return true
  }
}
