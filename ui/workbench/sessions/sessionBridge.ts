import { create } from 'zustand'

import type { SessionStatus } from '../../domain'

/** What the editor side knows about one terminal / RDP session of this window. */
export interface SessionInfo {
  id: string
  connId: string
  name: string
  connType: string
  /** The workspace the session was opened for (its connection's, else by working folder). */
  workspaceId: string | null
  status: SessionStatus
  /** A foreground process is running (local shells only; undefined when unknown). */
  busy: boolean | undefined
  cwd: string | null
  /** The shell was started with a command (a script run), not as an interactive shell. */
  hasCommand: boolean
  /** Whether the session can be popped out into its own window, or is out and can come back. */
  detach?: 'detach' | 'attach' | null
  /** Where it runs, for the status bar: the working folder (local) or `user@host:port` (remote). */
  location?: string | null
  /** Human-readable shell name, e.g. "PowerShell 7" (local shells only). */
  shellLabel?: string | null
}

/** Operations the OmniTerm shell offers the session tabs; the shell republishes it on every render. */
export interface SessionBridgeApi {
  /** The existing kill path: disconnect, clear state, release the ephemeral connection. */
  killSession(id: string, sessionAlreadyClosed?: boolean): void
  /** Starts a new shell in the same working folder and workspace as `id`. */
  newSessionLike(id: string): void
  /** Starts the agent `id` runs, with the same profile, in a new session in the same folder and workspace. */
  duplicateAgent?(id: string): void
  reconnect(id: string): void
  /** `skipTerminalCloseConfirm` is on: closing never asks. */
  skipConfirm(): boolean
  /** Remembers "don't ask again" from the close dialog. */
  setSkipConfirm(): void
  /** Pops the session out into its own window, or folds it back (what its `detach` state says). */
  toggleDetach?(id: string): void
  /** The terminal themes a session can take, and the one it has now (null: no such session). */
  terminalThemes?(id: string): { themes: ReadonlyArray<{ id: string; name: string }>; current: string } | null
  /** Gives one session its own terminal theme. */
  applyTerminalTheme?(id: string, themeId: string): void
}

interface SessionBridgeState {
  sessions: SessionInfo[]
  /** The restore of the saved sessions finished (or there was nothing to restore). */
  restoreRequested: boolean
  /**
   * `restoreRequested`, and the restored sessions are published here too: tabs can be reconciled.
   * Set by the publisher in the same update as `sessions`, so a restored session never looks unknown.
   */
  restoreSettled: boolean
  /** The pane grid the saved snapshot carried: the reconciler places session tabs from it once. */
  legacyLayout: LegacyLayout | null
  api: SessionBridgeApi | null
}

export interface LegacyLayout {
  layoutMode: number
  panes: (string | null)[]
  focusedPane: number
}

export const useSessionBridge = create<SessionBridgeState>(() => ({
  sessions: [],
  restoreRequested: false,
  restoreSettled: false,
  legacyLayout: null,
  api: null,
}))

export function sessionById(id: string): SessionInfo | undefined {
  return useSessionBridge.getState().sessions.find((session) => session.id === id)
}

/** Called by the restore hook once the saved panes were recreated (or there was nothing to restore). */
export function markSessionRestoreSettled(): void {
  if (!useSessionBridge.getState().restoreRequested) useSessionBridge.setState({ restoreRequested: true })
}

/** The saved snapshot's pane grid, offered to the migration (consumed by the reconciler). */
export function setLegacyLayout(layout: LegacyLayout | null): void {
  useSessionBridge.setState({ legacyLayout: layout })
}

export function resetSessionBridge(): void {
  useSessionBridge.setState({ sessions: [], restoreRequested: false, restoreSettled: false, legacyLayout: null, api: null })
}
