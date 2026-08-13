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
