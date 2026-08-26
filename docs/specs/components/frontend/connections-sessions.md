---
id: component-frontend-connections-sessions
status: current
area: components-frontend
navigation: "Renderer > Connections / Sessions"
platforms:
  - renderer
  - desktop
tags:
  - react
  - connections
  - terminal
related:
  - feature-connection-management
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Frontend Connections Sessions

## Description

Catalog of connection forms, project connection rows, live terminal/RDP views, session tabs, progress and metrics components.

## What

Connection components manage reusable profile drafts; session components render native runtime identities/events.

## Why

Keeping configuration and runtime views separate avoids accidental coupling between profile persistence and process lifetime.

## How

Forms emit structured data/actions. Session components consume session IDs and terminal/RDP APIs. Shared terminal utilities own xterm stream/options/links.

## When

When editing/launching connections or rendering/updating live sessions.

## Behavior

- Connection draft lifecycle is separate from live session lifecycle.
- Terminal cleanup does not imply profile deletion.

## Functionalities

- `ConnectionForm` — owned by this spec.
- `ConnectionAdvanced` — owned by this spec.
- `WorkspaceConnectionRow` — owned by this spec.
- `SessionTabs` — owned by this spec.
- `TerminalView` — owned by this spec.
- `RDPView` — owned by this spec.
- `ConnectingOverlay` — owned by this spec.
- `WaitingPane` — owned by this spec.
- `SessionMetricsChips` — owned by this spec.
- `SessionControlButtons` / `sessionControlOverflow` — owned by this spec.
- `SessionPersistenceMenu` — owned by this spec.
- `SessionStatusIndicator` — owned by this spec.
- `SessionFooterBar` — owned by this spec.
- `SessionUnavailableOverlay` — owned by this spec.
- `NewTerminalMenu` — owned by this spec.
- `TerminalLinkMenu` / `TerminalViewLinkMenuHost` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `ConnectionForm` | Create/edit connection draft. | Unified profile UX. | Controlled fields and submit callback. | Create/edit. |
| `ConnectionAdvanced` | Render type-specific advanced fields. | Keep base form compact. | Conditional inputs by connection type. | Advanced section. |
| `WorkspaceConnectionRow` | Render project-scoped connection. | Expose workspace connections. | Bind open/edit/delete. | Workspace connection exists. |
| `SessionTabs` | Render/select/close sessions. | Navigate concurrent sessions. | Map session IDs to tab controls. | Sessions exist. |
| `TerminalView` | Render xterm session. | Interactive shell UX. | Attach stream/input/resize/theme. | Terminal active. |
| `RDPView` | Render RDP presentation. | RDP is not PTY terminal. | Bind RDP-specific state/actions. | RDP active. |
| `ConnectingOverlay` | Show async connection progress. | User feedback. | Render launch status. | Connecting. |
| `WaitingPane` | Render no/awaiting session state. | Clear empty-pane UX. | Present placeholder/action. | No active content. |
| `SessionMetricsChips` | Render session metrics. | Expose activity/health. | Map native metrics to chips. | Metrics available. |
| `SessionControlButtons` / `sessionControlOverflow` | Shared session header/footer actions with responsive overflow handling. | Keep Stop, Clear, Fullscreen, Detach, and Persistence actions uniform and responsive to narrow panes. | Renders action icon buttons, measures container overflow via `controlsOverflow`, and collapses hidden items into an overflow popup menu. | Pane header or active footer bar rendered. |
| `SessionPersistenceMenu` | Per-terminal persistence policy selector. | Configure lifetime policy (None, Window, Hybrid, App). | Open dropdown menu and invoke daemon persistence updates. | User clicks persistence indicator. |
| `SessionStatusIndicator` | Render session status dot/animation. | Visual cue for connected/busy/idle/disconnected. | Render status indicator with oscillate or ping styles. | Pane header, footer, or tabs. |
| `SessionFooterBar` | Render bottom footer bar for active session. | Quick access to controls and status. | Compose status, persistence menu, and session controls. | Active session in focused pane. |
| `SessionUnavailableOverlay` | Render unavailable-session recovery feedback and restart action. | Provide clear user recovery when an attached session is lost or disconnected. | Renders an opaque recovery prompt and triggers the supplied restart action. | When an attached session is no longer available. |
| `NewTerminalMenu` | Quick shell, workspace folder, and connection launcher dropdown. | Unified launcher from tab bars, title bar, and activity bar. | Renders filtered workspaces and available shells; arrow keys own the cursor (scroll-synthetic mouseenter cannot steal it), the active row carries an accent ring, and Enter launches the highlighted row. | When clicking the new terminal `+` dropdown. |
| `TerminalLinkMenu` / `TerminalViewLinkMenuHost` | Modifier-click link/path context menu. | Copy or open detected URLs and file paths. | Portal overlay menu triggered by Ctrl/Cmd+click on actionable spans. | User modifier-clicks detected link or path. |

## State and data

- Connection drafts
- Session IDs/selection
- Terminal instance
- Connection status
- Metrics

## Errors and edge cases

- Validation/start/stream failures surface in owning form/overlay/session state.

## Security and invariants

- Sensitive inputs are not intentionally persisted by components.
- Terminal links are URL-gated.

## Verification

- Connection component tests
- Terminal/session/RDP tests

## Source map

- `ui/components/ConnectionForm.tsx`
- `ui/components/ConnectionAdvanced.tsx`
- `ui/components/WorkspaceConnectionRow.tsx`
- `ui/components/SessionTabs.tsx`
- `ui/components/TerminalView.tsx`
- `ui/components/RDPView.tsx`
- `ui/components/SessionControlButtons.tsx`
- `ui/components/sessionControlOverflow.ts`
- `ui/components/SessionPersistenceMenu.tsx`
- `ui/components/SessionStatusIndicator.tsx`
- `ui/components/SessionFooterBar.tsx`
- `ui/components/SessionUnavailableOverlay.tsx`
- `ui/components/NewTerminalMenu.tsx`
- `ui/components/TerminalLinkMenu.tsx`
- `ui/components/TerminalViewLinkMenuHost.tsx`
