---
id: feature-pasted-image-viewer
status: current
area: sessions
navigation: "Per-pane pasted-image history with a full-resolution pager viewer"
platforms:
  - desktop
  - tauri
tags:
  - terminal
  - session
  - clipboard
  - ui
related:
  - feature-terminal-status-link-menu
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Pasted Image Viewer

## Description

Defines the per-pane pasted-image pipeline: clipboard image bytes are persisted to a temp PNG that agents attach by path while the renderer keeps blob URLs for a capped per-session history, a pane-header button opens a full-resolution viewer modal, and the viewer pages through the history with chevrons or Left/Right keys.

## What

When an image is pasted into a terminal pane (native paste-event gate or Ctrl+V clipboard reader), the clipboard layer saves the bytes to `omniterm-paste-<stamp>.png` in the temp directory and inserts that path into the PTY — TUI agents (OpenCode, Claude Code…) attach the image by path because they can only render the raw bitmap as unreadable cell-block art. The same bytes are recorded in a per-session history (blob URL + temp path, capped at 12 entries, oldest evicted and revoked). The pane header shows an image button while a paste exists; activating it opens a full-resolution modal that opens on the newest image and flips through older pastes with chevron buttons or the Left/Right arrow keys, showing an `n / m` counter, per-image path copy, and Escape/backdrop/close dismissal.

## Why

A pasted screenshot is unreadable inside the terminal grid, and the agent only ever sees the temp file path — the human needs the real bitmap. Blob URLs (not `file://` paths) keep the webview from touching the filesystem directly, which is why the Tauri CSP `img-src` explicitly allows `blob:`. A history instead of a single slot lets the user compare successive pastes without re-pasting, and the cap bounds blob-URL memory in long sessions. The modal is portaled to `document.body` because its host `.terminal-pane` carries `filter: blur(...)` (unfocused-pane blur): a filtered ancestor becomes the containing block for `position: fixed` (clipping the dialog to the pane) and a stacking context that loses to the tab strip's `z-30` chrome.

## How

`terminalClipboard`'s paste paths call `saveImageTemp` (Rust `save_image_temp`) for the PTY path and hand `{ bytes, path }` to `setLastPastedImage(sessionId, saved)`. The store creates the blob URL (normalizing the view with `new Uint8Array(...)` for TS 5.7's `BlobPart`), appends to the session history, evicts past `MAX_PASTED_IMAGES` (revoking each evicted URL), and notifies slot subscribers. `TerminalView` mounts `PastedImageViewerHost sessionId={id}` and releases the history on unmount. `PaneHeader` reads `getLastPastedImage` to enable its image button and calls `requestOpen`; the host subscribes to open requests and the slot, renders nothing until both fire, and closes when the history empties. The viewer keeps `viewIndex: number | null` — `null` means "follow the newest paste"; a paste made while open jumps to the new image, and an out-of-range index (release/eviction) falls back to the newest. The keydown handler re-registers every render so Escape/Left/Right always see current bounds; Left/Right are gated on `images.length > 1` and clamped at the history ends.

## When

From the first image paste into a pane until the pane unmounts or the session closes (history release). The viewer is visible only while open; the header image button is available whenever the history is non-empty.

## Behavior

- Both paste paths (native paste-event gate and Ctrl+V reader) record `{ bytes, path }`; path insertion into the PTY is never gated on the store succeeding.
- History is per session id, oldest first, capped at 12; eviction and release revoke blob URLs. A null session id or empty payload is a no-op; an environment without object URLs is swallowed.
- The viewer opens on the newest image; chevron buttons and Left/Right page with clamping (no wrap); the pager (`‹ n / m ›`) renders only when more than one image exists; Previous/Next disable at the history ends.
- A paste made while the viewer is open jumps the view to the new image; releasing the history closes the viewer rather than rendering dead URLs.
- The overlay is portaled to `document.body` at `z-[60]`, above the `z-30` tab-strip chrome; Escape closes, backdrop click closes, in-dialog clicks do not.
- Focus lands on the close button on open and returns to the previous owner on dismiss.

## Functionalities

- `pastedImageStore` (`ui/utils/pastedImageStore.ts`) — per-session history slot: `setLastPastedImage` (append + evict + revoke), `getPastedImages` (stable snapshot for `useSyncExternalStore`), `getLastPastedImage` (newest), `releasePastedImage`, slot/open pub-sub.
- `PastedImageViewerHost` / `PastedImageViewer` (`ui/components/PastedImageViewerHost.tsx`) — portal modal, history pager, per-image path copy, keyboard contract.
- `PaneHeader` image button — enabled by `getLastPastedImage`, opens via `requestOpen`.
- `terminalClipboard` `onImageSaved` — bridges both paste paths into the store.
- `save_image_temp` (Rust) — persists the temp PNG the agent attaches by path.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `setLastPastedImage` | Append a paste to the session history. | The human needs the real bitmap later; the agent needs only the path now. | Create the blob URL (empty payloads and URL failures are no-ops), append, evict past the cap revoking each evicted URL, notify. | On every image paste, from either clipboard path. |
| `getPastedImages` / `getLastPastedImage` | Read the history / newest entry. | Subscribers need stable snapshots; the header only needs existence. | Return the stored array reference (module-level empty for missing slots) or the last element. | Pane header render, viewer host subscription. |
| `releasePastedImage` | Drop the whole history, revoking every URL. | Pane unmount / session close must not leak blob URLs. | Revoke each entry, delete the slot, notify. | `TerminalView` unmount for the session id. |
| `PastedImageViewerHost` | Own open state and view index; host the modal. | Keep `TerminalView` slim and the modal lifecycle per pane. | Subscribe to open requests + slot; `viewIndex: null` follows the newest; new pastes jump the view; empty history closes. | While the pane exists. |
| `PastedImageViewer` | Render the portal dialog with pager, path, and image. | Full-resolution preview the terminal grid cannot show. | `createPortal` to `document.body` at `z-[60]`; chevrons + Left/Right clamp at ends; counter only for multi-image; Escape/backdrop/close dismiss with focus restore. | While the viewer is open for the pane. |
| `PaneHeader` image button | Surface one-click access to the last pasted image. | Discoverability without remembering a shortcut. | Enabled by `getLastPastedImage(sessionId)`; click dispatches `requestOpen`. | Pane header render with a non-empty history. |
| `save_image_temp` | Persist clipboard bytes to the temp PNG. | Agents attach images by file path, not bytes. | Write `omniterm-paste-<stamp>.png` under the temp dir; return the absolute path. | During either image paste path. |

## State and data

- Per-session history: `PastedImage { objectUrl, path }[]`, oldest first, capped at `MAX_PASTED_IMAGES = 12`; snapshots are stable references for `useSyncExternalStore`.
- Viewer state: `open` boolean and `viewIndex: number | null` (`null` = follow newest); the effective index clamps to `images.length - 1`.
- Temp PNG path inserted into the PTY is plain text in the scrollback — it is the agent's attachment handle, not a secret.

## Errors and edge cases

- Empty byte payloads and null session ids never touch the store; blob-URL creation failures are swallowed so paste into the PTY always proceeds.
- Eviction and release revoke URLs before/with removal so the viewer never renders a dead URL while open; a released history closes the viewer.
- An explicit `viewIndex` past the history end (after eviction) falls back to the newest image.
- The modal must stay portaled: rendering it inline inside the blurred pane both clips it (filter = containing block for `fixed`) and buries it under the `z-30` tab strip (filter = stacking context).
- WebView2 blocks `blob:` images unless CSP `img-src` allows `blob:` — without it the dialog renders a broken-image placeholder.

## Security and invariants

- The renderer only ever holds blob URLs for bytes it already had; it never reads the temp file back from disk, so no filesystem-read surface is added.
- The CSP addition is scheme-scoped to `img-src`: blob URLs are same-origin and creatable only by the page's own script, so no remote-load surface appears.
- Temp PNGs live in the OS temp directory with the app's existing paste lifecycle; nothing here persists user image data beyond what paste already did.

## Verification

- `ui/utils/__tests__/pastedImageStore.test.ts` — append/history order, stable empty snapshot, cap eviction with revocation, per-session isolation, release revokes all, no-op payloads, object-URL-less environments, open pub-sub.
- `ui/components/__tests__/PastedImageViewerHost.test.tsx` — open gating, Escape/close/backdrop dismissal, single-image pager hidden, chevron navigation with clamped ends, Left/Right keys, jump-to-new-paste while open, close on release.
- `ui/components/__tests__/PaneHeader.pastedImage.test.tsx` — header button enablement per session slot.

## Source map

- `ui/utils/pastedImageStore.ts`
- `ui/components/PastedImageViewerHost.tsx`
- `ui/components/PaneHeader.tsx`
- `ui/utils/terminalClipboard.ts`
- `ui/components/TerminalView.tsx`
- `src-tauri/src/app_utils.rs` (`save_image_temp`)
- `src-tauri/tauri.conf.json` (CSP `img-src` `blob:`)
