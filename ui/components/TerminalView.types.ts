import type { EnterModes } from '../utils/enterKeys'
import type { TerminalTheme } from '../themes'
import type { Connection, SessionStatus } from './MainLayout'

export interface TerminalViewProps {
  id: string
  connection: Connection
  onStatus?: (status: SessionStatus) => void
  /** Called when an attached session no longer exists and this pane needs a fresh session. */
  onRestart?: () => void
  /** Live session metrics (latency + remote CPU/RAM/disk) pushed from the main process. */
  onMetrics?: (m: SessionMetrics) => void
  /**
   * The shell started/stopped running something. LOCAL only (it needs a process-tree probe on the
   * host), and only under the Tauri backend — elsewhere it simply never fires.
   */
  onActivity?: (busy: boolean) => void
  /** Receives OSC title updates emitted by shells and interactive agents. */
  onTitleChange?: (title: string) => void
  /** Shell-reported working directory (OSC 7 / OSC 9;9). Fires whenever the shell changes dir. */
  onCwdChange?: (cwd: string) => void
  /**
   * The pane's process ended, carrying its exit status. Separate from `onStatus('closed')` because the
   * status alone cannot tell a script that finished from one that failed — see sessionExit.ts.
   */
  onExit?: (code: number) => void
  theme?: TerminalTheme
  /** Appearance hint passed to locally spawned CLI tools so their palette matches xterm. */
  darkMode?: boolean
  fontSize?: number
  /** Client-side editor-style coloring of plain output (errors, numbers, paths…). */
  smartColors?: boolean
  fontFamilyMono?: string
  /**
   * Reports a font-size change made inside the terminal (Ctrl+wheel) as an absolute size, so the
   * owner can persist the override and keep its own display in sync. Without this the wheel would
   * mutate only this xterm instance and the change would be lost on the next remount.
   */
  onFontSizeChange?: (size: number) => void
  /**
   * 'connect' (default) starts a fresh SSH/PTY session. 'attach' binds to an already-running
   * session owned by the main process (used when a session is popped out into a detached window
   * or folded back into the main window): it replays the buffered output and subscribes to live
   * data WITHOUT reconnecting, so the underlying process is never duplicated.
   */
  mode?: 'connect' | 'attach'
  /**
   * Is this pane currently on screen? Panes not in a visible slot stay mounted (so their session
   * keeps streaming) but are hidden with `visibility: hidden`, which — unlike `display: none` —
   * leaves clientWidth/Height intact. That is what keeps xterm's scroll position and cell grid
   * correct across a tab switch, and it is also why the pane's own geometry can no longer tell it
   * whether it is visible: this prop is the signal instead. Defaults to true for owners with a
   * single always-visible pane (DetachedTerminalWindow).
   */
  active?: boolean
  /** Changes when the pane geometry changes without changing session visibility. */
  layoutEpoch?: string
  shortcuts?: ShortcutBindings
  /**
   * What Shift+Enter and Ctrl+Enter send. xterm collapses both to a bare `\r`, so AI agents cannot
   * tell them from a plain Enter without the app injecting a sequence — see utils/enterKeys.ts.
   */
  enterModes?: EnterModes
  blurStrength?: number
}
