---
id: feature-terminal-status-link-menu
status: current
area: sessions
navigation: "Terminal pane running indicator + link-modifier-click link/path menu"
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

Defines the live "running" indicator's busy/idle signal (backend-driven), the pane-header oscillating main dot plus two-ghost trail, and the link-modifier-click link/path overlay menu surfaced inside a terminal pane. Right-click stays reserved for the long-standing copy-selection / paste behaviour.

## What

A live pane presents a status indicator whose busy/idle state is owned by the backend's per-session activity probe. Ordinary shells remain process-tree driven; recognized AI-agent TUIs use their OSC 0/2 title, recent autonomous PTY output, and process-tree growth above the agent's idle baseline while suppressing immediate local-input echo. The pane header renders an oscillating main dot plus two ghost-trail dots while busy. A platform link-modifier click (Ctrl on Windows/Linux, Cmd on macOS) + left-button on a detected URL or file path in the terminal surface first offers a focused overlay menu (Copy Link / Open Link, or Copy Path / Open in OS); modifier clicks that miss any detection fall through to xterm's normal selection. Right-click keeps its long-standing copy-selection / paste behaviour unchanged.

## Why

The prior user-typing heuristic confused "I am typing" with "something is running", while a pure process-tree probe also treated a long-lived AI-agent TUI itself as permanent work. Keeping the renderer event-only and making the daemon agent-aware preserves conventional shell detection while letting an idle agent and user typing read idle; autonomous output and newly spawned tool processes still read running. The link-modifier-click overlay gives the pane a discoverable gesture that disambiguates "copy selection" vs. "open this link" without taking over right-click (which keeps its predictability for paste users). xterm's own `linkHandler` is downgraded to a no-op so the modifier click no longer direct-opens URLs underneath the overlay, and the plain-URL linkifier is retained purely for its underline-on-hover cue — both paths share the same platform modifier check (`isTerminalLinkModifierClick`).

## How

`attachTerminalStream` wires `onLocalActivity(busy)` up-front and never converts renderer-side bytes to a "busy" short-circuit; backend activity is the only edge that toggles busy. In `session-core`, `AgentActivityTracker` recognizes known agents from OSC 0/2 titles, records local input before the PTY write, immediately clears prior autonomous-output activity while the user is typing, suppresses output inside the short input-echo window, and retains a short tail after later autonomous output. The activity poller keeps process-tree detection for ordinary shells; for agents it snapshots the idle descendant count and treats later descendant growth as tool/internal-process work. The pane header passes `runningStyle='oscillate'` to `SessionStatusIndicator`, which renders a fixed-width bay (`w-10 h-2`) holding three absolutely-positioned dots; a CSS keyframe drives the main dot's oscillation across the bay, and ghost `animation-delay`s produce the trailing fade image. `createTerminalContextMenu` returns two handlers: `onContextMenu` (paste-fallback only — copy-selection if a range is set, otherwise paste) and `onLinkClick` (a `mousedown` listener that requires `isTerminalLinkModifierClick(e)` + `button === 0`, then runs `findLinkOrPathInTerminal` against the click target — a detection invokes `setLinkMenu`). xterm's `linkHandler` and the plain-URL linkifier's `ILink.activate` are both no-ops so the modifier click never direct-opens the URL underneath the overlay; the linkifier stays for the hover-underline cue only. `open_in_system` is the OS-open command the "Open in OS" item calls; `validate_path_for_open` pure-validates the trimmed path on the Rust side before being opened via `opener::open`.

## When

From the first observed `onLocalActivity` event right after a session starts, through to the dot going idle once the backend confirms idle; `onLinkClick` detection runs on every `mousedown` that has the platform link-modifier held, and `onContextMenu` (paste-fallback) runs on every `contextmenu` event a pane emits.

## Behavior

- Renderer busy/idle is only driven by the backend activity channel; renderer-side typing or output bytes never flip it directly.
- Ordinary local shells keep the process-tree busy signal. A recognized agent's own long-lived TUI process becomes its idle baseline instead of pinning the session to running.
- Local input immediately clears a recognized agent's prior output-busy state; agent output inside the following 500 ms echo window is ignored. Later autonomous output keeps the agent busy for a 1.5 s tail, and descendant growth above the learned idle baseline marks spawned tool/internal-process work busy.
- Two idle poll ticks are still required before a running session reports idle, preventing animation chatter between output chunks.
- Remote panes (SSH/RDP) never receive `onLocalActivity`; their busy state is unknown and the indicator stays solid.
- The oscillating running style is wired to the pane header only. Picker dropdown and tab indicators keep the legacy `ping` running style.
- A platform link-modifier + left click (Ctrl on Windows/Linux, Cmd on macOS) on a detected URL surfaces Copy Link and Open Link. The same modifier click on a detected path surfaces Copy Path and Open in OS; the Open in OS item is hidden when the pane is not `LOCAL`, since the backend open runs on this host, not the remote one.
- Modifier clicks that miss a detected span fall through silently (xterm keeps its normal click / selection behaviour). No link overlay is opened for plain left-clicks, so text selection and caret placement are preserved.
- Right-click ALWAYS takes the legacy copy-selection / paste path and never opens the link overlay; the suppression window keeps Chromium's native paste from duplicating the routed paste.
- xterm's `linkHandler.activate` and the plain-URL linkifier's `ILink.activate` are both no-ops; the underline-on-hover cue still shows under the platform modifier so users can see candidate spans, but the modifier click's open action only ever goes through the overlay menu's Copy/Open items.

## Functionalities

- `attachTerminalStream` — extended: renderer busy/idle is driven only by `onLocalActivity`.
- `AgentActivityTracker` / daemon activity poller — recognize agent OSC titles, suppress input echo, track recent autonomous output, and compare agent descendant counts against the idle baseline.
- `SessionStatusIndicator` — extended: Phase B adds `runningStyle='ping' | 'oscillate'` prop + the oscillate branch with two ghost-trail dots.
- `PaneHeader` — extended: Phase B passes `runningStyle='oscillate'` to the indicator on the pane header.
- `findLinkOrPathAt`, `findLinkOrPathInTerminal`, `TerminalLinkMenuKind`, `DetectedLinkOrPath` — Phase C detection surface for URLs and filesystem paths.
- `createTerminalContextMenu`, `TerminalLinkMenuState`, `TerminalContextMenuHandlers` — Phase C glue between xterm's contextmenu/mousedown and the overlay menu state; Phase D moved detection to the modifier-click handler and right-click to paste-fallback only.
- `isTerminalLinkModifierClick` — single source of truth for the platform link modifier (Cmd on macOS, Ctrl elsewhere) shared by the modifier-click handler and (via xterm's hover) the underline-on-hover cue.
- `activateTerminalLink` (removed in Phase D) — the historical direct-open handler folded into the overlay menu's `openUrl` callback so modifier-click always surfaces the menu instead.
- `TerminalLinkMenu`, `TerminalViewLinkMenuHost` — Phase C menu surface and host glue.
- `app.openInSystem`, `open_in_system`, `validate_path_for_open` — Phase C OS-open path boundary.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `attachTerminalStream` | Drive pane busy/idle from backend activity. | Keep the renderer from equating typing with work. | Wire `onLocalActivity(busy)` only; renderer bytes never set activity. | Throughout a session's live IO. |
| `AgentActivityTracker` / daemon activity poller | Derive agent-aware busy/idle. | An idle agent process must not look permanently busy while real output/tools must still animate. | Parse OSC 0/2 titles, force idle on fresh local input, suppress immediate input echo, tail later autonomous output, and compare descendant count with the learned agent baseline; ordinary shells keep process-tree detection. | Every local-session activity tick and PTY IO edge. |
| `SessionStatusIndicator` | Render running indicator (animated oscillate branch). | Show ongoing running state without strobing under user-typing. | Bay with main dot (oscillating keyframe) plus two ghost-trail dots with staggered animation-delay. | On every pane header, picker dropdown, and tab indicator that needs the running state. |
| `PaneHeader` | Pass `runningStyle='oscillate'` to the indicator. | Use the oscillating running style on the prominent pane header. | Forward `runningStyle` prop to `SessionStatusIndicator` only on the pane header. | Whenever a pane header is rendered. |
| `findLinkOrPathAt` / `findLinkOrPathInTerminal` / `isTerminalLinkModifierClick` | Detect URL or file path under a link-modifier click; gate the platform modifier. | Disambiguate copy-selection vs. modifier-click-open when on actionable text. | URL-first lookup via `PLAIN_URL_RE` then `FILE_PATH_RE`; map click coords to terminal buffer col; shared modifier check (Cmd on macOS, Ctrl elsewhere). | On every terminal pane modifier-click handled via `createTerminalContextMenu.onLinkClick`. |
| `createTerminalContextMenu` | Build the pane's `onContextMenu` (paste-fallback) and `onLinkClick` (modifier-click menu) handlers as a pair. | Split glue from `TerminalView` to keep file-size limits and unit-test each branch. | `onLinkClick` runs a modified detection hit → `setLinkMenu`; `onContextMenu` always delegates to clipboard copy/paste + native-paste suppressor. | When `TerminalView` wires its contextmenu and mousedown listeners. |
| `TerminalLinkMenu` | Render the Copy/Open overlay menu. | Surface the dedicated actions and gate on Local vs. remote. | Portal menu, viewport-clamped, kind-based items, outside-click + Escape close. | While `linkMenu` state is set on the host pane. |
| `TerminalViewLinkMenuHost` | Host the menu from `TerminalView` without bloating that file. | Keep `TerminalView` under its line limit and own the action callbacks. | Reads `linkMenu` state; renders `TerminalLinkMenu` when non-null with copy/openURL/openPath callbacks defined once. | While `linkMenu` is non-null. |
| `app.openInSystem` / `open_in_system` / `validate_path_for_open` | Open a path with the OS handler, validating it first. | Keep the OS-open boundary explicit and reject URLs/control chars. | Tauri command validates the trimmed path then `opener::open(trimmed)`. | When the user picks "Open in OS" in the link menu. |

## State and data

- Pane busy/idle state: accessible via the `onLocalActivity(busy)` callback; the pane's setter dedupes edge transitions.
- `linkMenu` overlay state on the host pane: `{ x, y, kind: 'url' | 'path', text } | null`; `open` action routes through the host glue's `copyText` / `openUrl` / `openPath` callbacks defined once.
- Backend `activity` session event from the hybrid per-session probe (poll interval 500 ms, idle confirm 1 s, command grace ~2 s, agent input-echo quiet 500 ms, agent output tail 1.5 s).

## Errors and edge cases

- A link-modifier click outside the terminal element — on whitespace where no URL or path is detected — is silently ignored; xterm keeps control of the click (selection/caret). A right-click anywhere is unconditionally the legacy copy-selection / paste path (no overlay).
- `validate_path_for_open` rejects (i) empty inputs, (ii) URLs / schemes (`://`), or (iii) control characters; the failure string is returned to the renderer.
- The native paste suppression window arms only on the `onContextMenu` paste branch (a Chromium native paste is suppressed for 250ms after the routed paste fires). `onLinkClick` never arms it — opening a link should never have a side effect on a later paste.
- OSC 8 escape-sequence hyperlinks are a known downgrade: xterm's `linkHandler.activate` is a no-op, and `findLinkOrPathInTerminal` reads visible buffer text only (`translateToString`), so the URL metadata is invisible to the detector — modifier-click on an OSC 8 span offers no menu. Plain HTTP(S) URLs in output are still caught because the URL itself is visible in the buffer.
- Lookbehind guards: the Windows-drive alternative denies a preceding letter so the `le:/` slice inside a `file:///…` URL cannot be mis-detected as a path; the POSIX-absolute alternative requires a non-slash after the leading `/` so a `///` noise run from a `file://` URL is NOT folded into the matched path.
- WSL panes are a known blind spot: bash/build processes inside the distro's VM do not surface in the host process probe, so WSL panes read as idle.

## Security and invariants

- "Open in OS" routes through `opener::open` on the validated, trimmed path; URLs are rejected by `validate_path_for_open`. Refusing `://` keeps custom protocol handlers (e.g. `file://`, `mailto:`, or arbitrary custom schemes) from becoming program execution vectors here, matching the existing `is_allowed_plugin_url` gate's intent.
- The "Open in OS" item is hidden for non-LOCAL panes — the backend open would run on this host, not the SSH/RDP host.
- The "Open Link" action (the menu's `openUrl`, now the single open path — replaces the old `activateTerminalLink` direct-open) mirrors the long-standing Ctrl/Cmd-click behaviour: `safeHttpUrl` rejects credentials, whitespace, control characters, and non-`http(s)` schemes before opening. Only transparent `_blank` with `noopener,noreferrer` is launched. xterm's `linkHandler.activate` and the linkifier's `ILink.activate` are both no-ops, so the modifier click can no longer bypass the menu to open a URL.
- Path detection in the renderer is best-effort; the validator on the Rust side is the authoritative boundary and may reject any input the detector emitted.

## Verification

- `ui/__tests__/terminalStream.activity.test.ts` — backend activity drives busy/idle; idle wins mid-arrival; remote panes never fire activity.
- `ui/components/__tests__/SessionStatusIndicator.test.tsx` — oscillate branch renders `animate-running-dot-oscillate` plus both ghost trail classes; default falls back to `animate-ping`.
- `ui/components/__tests__/PaneHeader.coverage.test.tsx` — pane header asserts the oscillate markers in the running case.
- `ui/utils/__tests__/terminalLinks.test.ts` — URL/path detection, lookbehind guard against `file://` fragments, multi-pattern cases, trailing punctuation trim; `isTerminalLinkModifierClick` returns true only under the platform modifier (Cmd on macOS, Ctrl elsewhere).
- `ui/utils/__tests__/createTerminalContextMenu.test.ts` — `onLinkClick` overlay dispatch when a URL is detected under the platform modifier, gating on modifier + left-button, silent fall-through on miss; `onContextMenu` paste-fallback only (never opens the link overlay); suppression window arms only on the paste branch.
- `ui/components/__tests__/TerminalLinkMenu.test.tsx` — kind-based item rendering, remote-hide of "Open in OS", Escape / outside-click closure, in-menu click does not close, callback wiring.
- `src-tauri/src/app_utils_tests.rs` — `validate_path_for_open` accepts absolute and relative paths; rejects URLs, empty inputs, and control characters; trims trailing whitespace.

## Source map

- `ui/utils/terminalStream.ts`
- `crates/session-core/src/agent_activity.rs`
- `crates/session-core/src/activity.rs`
- `crates/session-core/src/output.rs`
- `crates/session-core/src/manager.rs`
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
