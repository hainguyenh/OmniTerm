---
id: feature-terminal-status-link-menu
status: current
area: sessions
navigation: "Terminal pane running indicator + right-click link/path menu"
platforms:
  - desktop
  - tauri
tags:
  - terminal
  - session
  - xterm
  - ipc
related:
  - feature-terminal-lifecycle
  - feature-session-pty-detach
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Terminal Status Link Menu

## Description

Defines the live "running" indicator's busy/idle signal (backend-driven), the pane-header oscillating main dot plus two-ghost trail, and the right-click link/path overlay menu surfaced inside a terminal pane.

## What

A live pane presents a status indicator whose busy/idle state is owned by the backend's per-session activity probe (no user-typing heuristic), and the pane header renders an oscillating main dot plus two ghost-trail dots while busy. Right-clicking on a detected URL or file path in the terminal surface first offers a focused overlay menu (Copy Link / Open Link, or Copy Path / Open in OS); clicks that miss any detection fall through to the long-standing copy-selection / paste behaviour.

## Why

The prior user-typing heuristic confused "I am typing" with "something is running"; ~1.2s of inactivity shortly flicked the dot between states during long AI-agent output. The backend activity channel already emits a stable, conventional idle window, so routing the busy state through it keeps the indicator meaningful for shells, agents, and long-output sessions alike. The right-click overlay gives the pane a discoverable gesture that disambiguates "copy selection" vs. "paste" when the click lands on actionable text — without removing the legacy copy/paste behaviour for clicks that miss a URL or path.

## How

`attachTerminalStream` wires `onLocalActivity(busy)` up-front and never converts bytes to a "busy" short-circuit; backend activity is the only edge that toggles busy. The pane header passes `runningStyle='oscillate'` to `SessionStatusIndicator`, which renders a fixed-width bay (`w-10 h-2`) holding three absolutely-positioned dots; a CSS keyframe drives the main dot's oscillation across the bay, and ghost `animation-delay`s produce the trailing fade image. The right-click handler is built by `createTerminalContextMenu`, which calls `findLinkOrPathInTerminal` against the click target; on a detection it invokes `setLinkMenu`, otherwise it delegates to the existing copy/paste clipboard flow with a one-shot native-paste suppression window. `open_in_system` is the OS-open command the "Open in OS" item calls; `validate_path_for_open` pure-validates the trimmed path on the Rust side before being opened via `opener::open`.

## When

From the first observed `onLocalActivity` event right after a session starts, through to the dot going idle once the backend confirms idle; right-click detection is invoked on every contextmenu event a pane emits.

## Behavior

- Busy/idle is only driven by the backend activity channel. Bytes do not flip it; neither does silent or stalled output.
- Idle wins over a fresh busy edge while no active signal is in flight; mid-arrival output does not supersede the idle window.
- Remote panes (SSH/RDP) never receive `onLocalActivity`; their busy state is unknown and the indicator stays solid.
- The oscillating running style is wired to the pane header only. Picker dropdown and tab indicators keep the legacy `ping` running style.
- Right-click on a detected URL surfaces Copy Link and Open Link. Right-click on a detected path surfaces Copy Path and Open in OS; the Open in OS item is hidden when the pane is not `LOCAL`, since the backend open runs on this host, not the remote one.
- Clicks outside any detected span fall back to the pre-existing right-click copy/paste behaviour; the suppression window keeps Chromium's native paste from duplicating the routed paste.

## Functionalities

- `attachTerminalStream` — extended: Phase A removes the bytes-driven activity debounce; busy/idle now driven only by `onLocalActivity`.
- `SessionStatusIndicator` — extended: Phase B adds `runningStyle='ping' | 'oscillate'` prop + the oscillate branch with two ghost-trail dots.
- `PaneHeader` — extended: Phase B passes `runningStyle='oscillate'` to the indicator on the pane header.
- `findLinkOrPathAt`, `findLinkOrPathInTerminal`, `TerminalLinkMenuKind`, `DetectedLinkOrPath` — Phase C detection surface for URLs and filesystem paths.
- `createTerminalContextMenu`, `TerminalLinkMenuState` — Phase C glue between xterm's contextmenu and the overlay menu state.
- `TerminalLinkMenu`, `TerminalViewLinkMenuHost` — Phase C menu surface and host glue.
- `app.openInSystem`, `open_in_system`, `validate_path_for_open` — Phase C OS-open path boundary.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `attachTerminalStream` | Drive pane busy/idle from backend activity. | Keep the indicator meaningful under shells, agents, and long sessions. | Wire `onLocalActivity(busy)` only; remove the bytes-driven debounce. | Throughout a session's live IO. |
| `SessionStatusIndicator` | Render running indicator (animated oscillate branch). | Show ongoing running state without strobing under user-typing. | Bay with main dot (oscillating keyframe) plus two ghost-trail dots with staggered animation-delay. | On every pane header, picker dropdown, and tab indicator that needs the running state. |
| `PaneHeader` | Pass `runningStyle='oscillate'` to the indicator. | Use the oscillating running style on the prominent pane header. | Forward `runningStyle` prop to `SessionStatusIndicator` only on the pane header. | Whenever a pane header is rendered. |
| `findLinkOrPathAt` / `findLinkOrPathInTerminal` | Detect URL or file path under a right-click. | Disambiguate copy-selection vs. paste when right-clicking actionable text. | URL-first lookup via `PLAIN_URL_RE` then `FILE_PATH_RE`; map click coords to terminal buffer col. | On every terminal pane right-click handled via `createTerminalContextMenu`. |
| `createTerminalContextMenu` | Build the pane's right-click handler. | Split glue from `TerminalView` to keep file-size limits and unit-test the dispatch. | Detection hit → `setLinkMenu`; else hand off to clipboard copy/paste + native-paste suppressor. | When `TerminalView` wires its contextmenu listener. |
| `TerminalLinkMenu` | Render the Copy/Open overlay menu. | Surface the dedicated actions and gate on Local vs. remote. | Portal menu, viewport-clamped, kind-based items, outside-click + Escape close. | While `linkMenu` state is set on the host pane. |
| `TerminalViewLinkMenuHost` | Host the menu from `TerminalView` without bloating that file. | Keep `TerminalView` under its line limit and own the action callbacks. | Reads `linkMenu` state; renders `TerminalLinkMenu` when non-null with copy/openURL/openPath callbacks defined once. | While `linkMenu` is non-null. |
| `app.openInSystem` / `open_in_system` / `validate_path_for_open` | Open a path with the OS handler, validating it first. | Keep the OS-open boundary explicit and reject URLs/control chars. | Tauri command validates the trimmed path then `opener::open(trimmed)`. | When the user picks "Open in OS" in the link menu. |

## State and data

- Pane busy/idle state: accessible via the `onLocalActivity(busy)` callback; the pane's setter dedupes edge transitions.
- `linkMenu` overlay state on the host pane: `{ x, y, kind: 'url' | 'path', text } | null`; `open` action routes through the host glue's `copyText` / `openUrl` / `openPath` callbacks defined once.
- Backend `activity` session event from the per-session process-tree probe (segment interval 500ms, idle confirm 1s, command grace ~2s).

## Errors and edge cases

- Right-click outside the terminal element, or on whitespace where no URL or path is detected, falls through to the legacy copy-selection / paste (no overlay).
- `validate_path_for_open` rejects (i) empty inputs, (ii) URLs / schemes (`://`), or (iii) control characters; the failure string is returned to the renderer.
- The native paste suppression window arms only on the paste branch (a Chromium native paste is suppressed for 250ms after the routed paste fires).
- Lookbehind guards: the Windows-drive alternative denies a preceding letter so the `le:/` slice inside a `file:///…` URL cannot be mis-detected as a path; the POSIX-absolute alternative requires a non-slash after the leading `/` so a `///` noise run from a `file://` URL is NOT folded into the matched path.
- WSL panes are a known blind spot: bash/build processes inside the distro's VM do not surface in the host process probe, so WSL panes read as idle.

## Security and invariants

- "Open in OS" routes through `opener::open` on the validated, trimmed path; URLs are rejected by `validate_path_for_open`. Refusing `://` keeps custom protocol handlers (e.g. `file://`, `mailto:`, or arbitrary custom schemes) from becoming program execution vectors here, matching the existing `is_allowed_plugin_url` gate's intent.
- The "Open in OS" item is hidden for non-LOCAL panes — the backend open would run on this host, not the SSH/RDP host.
- The "Open Link" action mirrors the long-standing Ctrl/Cmd-click path: `safeHttpUrl` rejects credentials, whitespace, control characters, and non-`http(s)` schemes before opening. Only transparent `_blank` with `noopener,noreferrer` is launched.
- Path detection in the renderer is best-effort; the validator on the Rust side is the authoritative boundary and may reject any input the detector emitted.

## Verification

- `ui/__tests__/terminalStream.activity.test.ts` — backend activity drives busy/idle; idle wins mid-arrival; remote panes never fire activity.
- `ui/components/__tests__/SessionStatusIndicator.test.tsx` — oscillate branch renders `animate-running-dot-oscillate` plus both ghost trail classes; default falls back to `animate-ping`.
- `ui/components/__tests__/PaneHeader.coverage.test.tsx` — pane header asserts the oscillate markers in the running case.
- `ui/utils/__tests__/terminalLinks.test.ts` — URL/path detection, lookbehind guard against `file://` fragments, multi-pattern cases, trailing punctuation trim.
- `ui/utils/__tests__/createTerminalContextMenu.test.ts` — overlay dispatch when a URL is detected; legacy copy/paste fallback when nothing matches; suppression window arms only on the paste branch.
- `ui/components/__tests__/TerminalLinkMenu.test.tsx` — kind-based item rendering, remote-hide of "Open in OS", Escape / outside-click closure, in-menu click does not close, callback wiring.
- `src-tauri/src/app_utils_tests.rs` — `validate_path_for_open` accepts absolute and relative paths; rejects URLs, empty inputs, and control characters; trims trailing whitespace.

## Source map

- `ui/utils/terminalStream.ts`
- `ui/components/SessionStatusIndicator.tsx`
- `ui/components/PaneHeader.tsx`
- `ui/utils/terminalLinks.ts`
- `ui/utils/createTerminalContextMenu.ts`
- `ui/components/TerminalLinkMenu.tsx`
- `ui/components/TerminalViewLinkMenuHost.tsx`
- `ui/components/TerminalView.tsx`
- `ui/omnitermAPI.ts` (`app.openInSystem`)
- `ui/vite-env.d.ts`, `ui/testUtils.tsx` (type + mock plumbing)
- `ui/index.css` (`@keyframes running-dot-oscillate`, `.animate-running-dot-oscillate`, `.running-dot-ghost-1`, `.running-dot-ghost-2`)
- `src-tauri/src/app_utils.rs` (`open_in_system`, `validate_path_for_open`)
- `src-tauri/src/app_utils_tests.rs`
- `src-tauri/src/lib.rs` (registration of `open_in_system`)
