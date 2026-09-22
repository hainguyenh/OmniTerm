---
id: feature-terminal-lifecycle
status: current
area: sessions
navigation: "Terminal panes / Session tabs"
platforms:
  - desktop
  - tauri
tags:
  - terminal
  - session
  - xterm
related:
  - feature-session-pty-detach
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Terminal Lifecycle

## Description

Defines renderer-visible terminal identity, pane/tab layout, xterm IO, native PTY lifetime, and restart reconstruction.

## What

A live terminal is a native-owned PTY identified by a stable pane/session ID. Across an application restart, OmniTerm preserves presentation metadata only: tabs, pane/view-group placement, connection metadata needed to relaunch, and each terminal's last working directory.

## Why

Pane layout should survive an app restart without keeping terminal processes alive after the application closes.

## How

While OmniTerm is running, the session daemon owns PTYs and streams output/status to renderer terminals. The renderer checkpoints layout and cwd metadata to localStorage. On the next launch, saved panes are recreated as fresh terminal processes at their saved directories; old process state, terminal output, commands, and persistence policy are not restored.

## When

From terminal start through live IO, pane changes, close/disconnect, app shutdown, and next-launch layout reconstruction.

## Behavior

- Session IDs remain stable through pane/view changes while the application is running.
- Terminal processes do not intentionally outlive OmniTerm. Every new native PTY uses close-with-app lifetime.
- Losing the owning GUI lease terminates all PTYs owned by that GUI. When no owned sessions remain, the session daemon exits.
- Restart reconstruction never attaches to a process from the previous app run. Any stale daemon session with the same stable ID is disconnected before a fresh PTY is created.
- Snapshot version 4 stores only restart reconstruction metadata: tab identity, connection launch metadata, view groups/panes, focused pane, and cwd/shell context.
- Legacy v1-v3 snapshots are migrated by extracting layout/cwd/shell metadata and dropping process-persistence policy, generation, scrollback key, and persisted command fields.
- The latest cwd reported by the terminal wins over the connection launch directory. If no live cwd was reported, the saved launch directory is used.
- A restored pane remains pending until native terminal startup reports success. Registration alone is not acknowledgement; failed startup keeps the saved reconstruction context and exposes a targeted retry that starts another fresh terminal.
- Closing a pane while startup is pending prevents late async registration from repopulating the layout.
- Closing the final hydrated terminal writes an explicit empty terminal layout.
- Stop is gated by an explicit live-session flag from the hosting header/footer, not by the activity probe.
- Stop is immediate and session-preserving: LOCAL sessions invoke native `interrupt_session`; SSH sessions send ETX through their PTY input channel.
- Connected-terminal close confirmation is shown by default. Choosing “Don't ask again” persists `skipTerminalCloseConfirm`; General settings can turn it off to restore the dialog.
- Visible xterm panes refit immediately and again on the next paint after a layout epoch change.

## Functionalities

- `TerminalView` — owned by this spec.
- `SessionTabs` — owned by this spec.
- `SessionUnavailableOverlay` — owned by this spec.
- `useSessionPersistence` / `useSessionRestore` / `useSessionRecoveryState` — owned by this spec.
- `sessionStore` / `sessionCheckpoint` — owned by this spec.
- `createSessionChannel` — owned by this spec.
- `attachTerminalStream` — owned by this spec.
- `createTerminalOptions` — owned by this spec.
- Stop interruption (`sessionLive` gate, LOCAL native interrupt, SSH ETX) — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `TerminalView` | Render a live xterm. | Interactive terminal UX. | Bind stream/input/resize/theme lifecycle to a live native session. | Terminal pane active. |
| `SessionTabs` | Select/close sessions. | Navigate concurrent panes. | Render stable pane/session IDs as tabs. | Sessions exist. |
| `SessionUnavailableOverlay` | Render a failed-restart prompt. | Give an explicit fresh-start retry path. | Displays the restore error and a Restart terminal action. | Fresh shell registration failed. |
| `useSessionPersistence` | Checkpoint restart metadata. | Preserve pane arrangement and cwd without persisting processes. | Writes versioned tab/connection/group/cwd metadata to localStorage. | Layout or cwd changes; page exit. |
| `useSessionRestore` | Recreate saved panes. | Restore visual working context after restart. | Disconnects stale same-ID sessions, registers fresh shells at saved cwd, and restores groups/panes. | App startup or explicit retry. |
| `useSessionRecoveryState` | Coordinate pending restore state. | Keep failed panes retryable without reviving old processes. | Merges unresolved checkpoint entries and exposes per-pane restore outcomes. | Startup restore/retry. |
| `sessionStore` / `sessionCheckpoint` | Validate/migrate/merge layout checkpoints. | Make restart metadata durable and backward compatible. | Migrates v1-v3 to v4 and keeps unresolved cwd/layout entries. | Load/save/partial restore. |
| `createSessionChannel` | Bind native session event channel. | Centralize subscription cleanup. | Subscribe callbacks by session ID. | Terminal starts. |
| `attachTerminalStream` | Feed native output to xterm. | Separate transport from view. | Subscribe/buffer/chunk terminal writes. | Output arrives. |

## State and data

- Live session IDs and native PTYs
- Selected tab and view-group/pane layout
- Terminal instance, status, metrics, and stream subscription
- Version 4 restart checkpoint: connection metadata, pane placement, focused pane, cwd/shell
- Session-control live-state gate
- Persisted close-confirmation preference (`skipTerminalCloseConfirm`)

Terminal output/scrollback and process state are runtime data and are not part of restart reconstruction.

## Errors and edge cases

- A stale session ID is explicitly disconnected before restart reconstruction creates a fresh shell.
- Missing/unavailable shell registration leaves a retryable pane placeholder.
- Invalid legacy/current snapshots are ignored rather than used to launch arbitrary process state.

## Security and invariants

- Renderer never owns raw native process handles.
- Restart metadata does not persist terminal commands or credentials.
- Terminal links use safe HTTP(S) handling.

## Verification

- Terminal/session component tests
- Layout/cwd snapshot migration tests
- Fresh-shell restore and retry tests
- Session daemon lease-loss tests
- IPC runtime tests

## Source map

- `ui/components/TerminalView.tsx`
- `ui/components/SessionTabs.tsx`
- `ui/components/SessionUnavailableOverlay.tsx`
- `ui/hooks/useSessionPersistence.ts`
- `ui/hooks/useSessionRestore.ts`
- `ui/hooks/useSessionRecoveryState.ts`
- `ui/utils/sessionCheckpoint.ts`
- `ui/utils/sessionStore.ts`
- `ui/utils/sessionChannel.ts`
- `ui/utils/terminalStream.ts`
- `ui/components/SessionControlButtons.tsx`
- `src-tauri/src/pty.rs`
- `src-tauri/src/pty_interrupt.rs`
