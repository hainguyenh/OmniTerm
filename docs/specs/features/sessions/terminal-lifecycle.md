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

Defines renderer-visible terminal session identity, tabs, xterm rendering, input/output, resize, status and close/disconnect interactions.

## What

A session is a native-owned runtime process/PTY identified by stable session ID and rendered by terminal/session components.

## Why

Process lifetime must survive renderer layout changes and remain distinct from reusable connection profiles.

## How

UI opens a native session, subscribes to output/status channels, writes input/resizes by session ID and renders xterm with shared options/theme helpers.

## When

From session start through live IO, resize, status changes, disconnect and close.

## Behavior

- Session ID remains stable through pane/view changes.
- Renderer cleanup does not invent a new session.
- Input/output are runtime stream data, not profile persistence.

## Functionalities

- `TerminalView` — owned by this spec.
- `SessionTabs` — owned by this spec.
- `SessionUnavailableOverlay` — owned by this spec.
- `useSessionPersistence` / `useSessionRestore` — owned by this spec.
- `createSessionChannel` — owned by this spec.
- `attachTerminalStream` — owned by this spec.
- `createTerminalOptions` — owned by this spec.
- `saveScrollback` / `loadScrollback` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `TerminalView` | Render live xterm. | Interactive terminal UX. | Attach stream/input/resize/theme lifecycle. | Terminal pane active. |
| `SessionTabs` | Select/close sessions. | Navigate concurrent sessions. | Render stable session IDs as tabs. | Sessions exist. |
| `SessionUnavailableOverlay` | Render unavailable session overlay and restart button. | Feedback and recovery when session exits or disconnects. | Displays recovery banner with restart action. | Attached session unavailable. |
| `useSessionPersistence` / `useSessionRestore` | Snapshot and restore live session state. | Preserve active tabs, view groups, and focused pane across restarts. | Snapshots layout to localStorage and restores on startup. | Layout changes and app startup. |
| `createSessionChannel` | Bind native session event channel. | Centralize subscription cleanup. | Subscribe callbacks by session ID. | Terminal attaches. |
| `attachTerminalStream` | Feed backend output to xterm. | Separate transport from view. | Subscribe/buffer/chunk terminal writes. | Output arrives. |
| `createTerminalOptions` | Build xterm configuration. | Consistent fonts/cursor/options. | Map settings/defaults. | Terminal creation. |
| `saveScrollback` / `loadScrollback` | Cache terminal scrollback in IndexedDB. | Preserve terminal buffer history across app restarts. | Serializes and restores PTY output chunk buffers. | Output chunk received and tab restore. |

## State and data

- Session IDs
- Selected tab
- Terminal instance
- Status/metrics
- Stream subscription
- Persisted layout snapshots and scrollback buffers

## Errors and edge cases

- Stale session ID/closed stream transitions to error/disconnected UI state.

## Security and invariants

- Terminal links use safe HTTP(S) handling; renderer never owns raw native process handles.

## Verification

- Terminal/session component tests
- IPC runtime tests
- Terminal utility tests
- Session persistence and restore tests

## Source map

- `ui/components/TerminalView.tsx`
- `ui/components/SessionTabs.tsx`
- `ui/components/SessionUnavailableOverlay.tsx`
- `ui/hooks/useSessionPersistence.ts`
- `ui/hooks/useSessionRestore.ts`
- `ui/utils/sessionChannel.ts`
- `ui/utils/terminalStream.ts`
- `ui/utils/scrollbackStore.ts`
- `ui/utils/sessionStore.ts`
