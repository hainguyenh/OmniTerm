---
id: feature-file-browser-view-editor
status: current
area: files
navigation: "Workspace tree > file"
platforms:
  - desktop
  - tauri
tags:
  - files
  - tree
  - viewer
  - editor
  - markdown
  - csv
  - json
  - html
related:
  - architecture-security-data
  - feature-workspace-operations
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature File Browser View Editor

## Description

Defines lazy file navigation plus the built-in file editor: in-place editing of any viewable workspace file with syntax highlighting, and rendered previews for Markdown, CSV/TSV, HTML and JSON.

## What

Files are discovered under saved workspace roots and identified by logical paths. Opening a file shows it in an editor tab built on CodeMirror 6 — viewport-only rendering, a tree-structured document, incremental background parsing — without completion or other IDE features. Every file the scan marks viewable opens editable. Markdown, CSV/TSV, HTML and JSON add a Code / Split / Preview switch.

## Why

Large repositories require paging, file access must remain contained, type-gated and size-bounded, and an editor must stay responsive with big, minified or malformed files and with many tabs open. The design follows VS Code and Zed: render only what is on screen, keep a per-tab model apart from the single live view, load grammars lazily and degrade features on large input instead of hanging.

## How

Folder skeleton/paged scans populate the renderer tree. Opening a file creates an editor tab whose document is read with `open_text_file` the first time the tab is shown; saving goes through `save_text_file` with the mtime and size that were loaded, so a file changed on disk since is reported as a conflict. The tab keeps its `EditorState` while hidden and builds an `EditorView` only while visible. Previews read the text after typing pauses; CSV indexing and JSON graph layout run in module workers.

## When

When browsing/expanding files, opening an editor tab, editing, saving, switching view mode or searching/filtering tree content.

## Behavior

- Directory skeleton can render before full file list.
- Like Zed and VS Code, "All files" shows every folder, including empty ones and dependency/build output (`node_modules`, `dist`, `build`, `out`, `vendor`, `coverage`, `.next`, `.turbo`, `.cache`, `__pycache__`). Those deferred folders are not walked up front: their subfolders arrive with their first page when expanded. `.git`, `.svn` and `.hg` stay hidden. Scripts, type and selection views never include deferred folders.
- Any viewable file opens editable; the scan's `editable` flag only marks scripts (Run/Launch).
- Excluded viewable extensions and the max open size (default 1 MiB, ceiling 25 MiB) are enforced natively on open and save.
- Feature profiles: `full` (≤ 2 MiB, ≤ 50k lines, longest line ≤ 10k) has highlighting, folding, bracket and selection matching; `large` and `longLines` open as plain text with a notice. A document that grows past the large limits while open is downgraded.
- Hidden tabs keep their document but no view; past 8 hidden states or 16M characters the least recently shown clean ones are dropped and re-read on show (cursor kept). Unsaved documents are never dropped.
- Line endings: the dominant EOL is used for every line on save (mixed files show a notice); LF/CRLF and the UTF-8 BOM are toggles in the status bar.
- Save conflicts: changed on disk → Overwrite or Reload from disk; deleted on disk → Save anyway (recreates the file).
- Running a dirty script saves it first and does not run if the save fails.
- Preview auto-render limits: Markdown 1 MiB (cap 5 MiB), HTML 2 MiB, SVG 2 MiB, JSON 5 MiB, CSV 25 MiB; above the limit a "Render anyway" action is offered. Worker jobs time out after 15 s.
- Raster images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF) are openable from the tree although the scan marks them not viewable as text; they open read-only in an image tab with fit / actual size / zoom (toolbar or Ctrl+wheel) on a checkerboard, and GIFs animate. Images up to 25 MiB are read, independent of the text open cap. SVG stays a text file and gets a rendered Split/Preview mode.
- For a file inside a Git work tree, the editor's right-click panel adds a Git group: File history (follows renames), History of selection (`git log -L` over the selected lines), Compare with branch… (branch picker, then the Git diff viewer against that branch) and Annotate (blame). The dialogs are the Git view's own modals; the editor re-reads a clean document after a branch diff closes, since that diff can save the file.
- The Git diff viewer reuses the same editor: a `@codemirror/merge` side-by-side view (base read-only, working copy editable) with the same extensions, theme, lazy grammars and profiles. The diff updates incrementally as the working copy is edited; Diff Only collapses unchanged lines, Full File expands them; the revert gutter applies a base chunk to the working copy; F7/Shift+F7 jump between changes. Conflicted files use a 3-way layout whose editable result is a CodeMirror view. Saves keep the loaded file's CRLF line endings.

## Functionalities

- `scan_folders` — owned by this spec.
- `scan_entries_page_excluding` — owned by this spec.
- `FileBrowser` — owned by this spec.
- `open_text_file` — owned by this spec.
- `save_text_file` — owned by this spec.
- `read_script` — legacy read used by workspace providers; unchanged.
- `write_script` — legacy script-only write; unchanged.
- `FileEditorTab` — owned by this spec.
- `PreviewPane` — owned by this spec.
- `MarkdownPreview` — owned by this spec.
- `CsvPreview` — owned by this spec.
- `HtmlPreview` — owned by this spec.
- `JsonGraphPreview` — owned by this spec.
- `open_image_file` — owned by this spec.
- `ImageFileTab` — owned by this spec.
- `git_file_context` / `git_file_history` — owned by this spec; reuse the Git view's modals.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `scan_folders` | Discover directory skeleton. | Fast initial tree. | Enumerate directories only. | Workspace load. |
| `scan_entries_page_excluding` | Page folder entries. | Bound IPC/render work. | Validate relative dir and slice classified entries. | Expand/show more. |
| `FileBrowser` | Render navigable file hierarchy. | File navigation UX. | Consume tree/expand/open callbacks. | Browser visible. |
| `open_text_file` | Read a viewable file for the editor. | Content plus the stats that pick a profile. | View gate, size cap, binary/UTF-8 sniff, BOM strip, EOL and line statistics. | Editor tab first shown or reloaded. |
| `save_text_file` | Write editor content. | Any text file is editable, so saves must be conflict-safe. | View gate, binary refusal, mtime/size conflict outcome, BOM re-add, atomic temp-file rename. | Ctrl+S, Save, Overwrite, Run on a dirty script. |
| `FileEditorTab` | In-place editor tab. | One fast workflow for every text file. | Lazy CodeMirror view, Code/Split/Preview, banners, status bar, tab-scoped Ctrl+S. | Editor tab rendered. |
| `useTextDocument` | Document lifecycle. | Keystrokes never re-render the tab. | Lazy load, dirty detection, profile escalation, save/reload, reveal. | Tab lifetime. |
| `DiffEditor` | Git side-by-side diff. | One editor engine for files and diffs; no per-line DOM. | MergeView with shared extensions, collapse toggle, revert gutter, dirty flips only. | Git diff viewer open. |
| `PreviewPane` | Preview router. | Previews must not hang or re-render per keystroke. | Settled-text debounce while visible, size gates, error boundary. | Split/Preview mode. |
| `MarkdownPreview` | Render Markdown from authorized content. | Rich document reading. | GFM render with strict Mermaid and a render timeout. | Markdown preview. |
| `CsvPreview` | Virtualized grid. | Large tables. | Worker row index, visible rows/columns only. | CSV/TSV preview. |
| `HtmlPreview` | Static page render. | Untrusted markup. | `sandbox=""` iframe with a network-free CSP. | HTML preview. |
| `JsonGraphPreview` | JSON Crack-style graph. | Structural view of JSON. | Worker parse/layout, culled SVG, collapse, jump to syntax error. | JSON preview. |
| `open_image_file` | Read image bytes for the viewer. | The text view gate refuses images by design. | Containment, raster allow-list, user exclusions, 25 MiB ceiling; binary IPC response. | Image tab first shown or retried. |
| `ImageFileTab` / `ImagePreview` | Image tab and stage. | Preview icons, screenshots and GIFs in place. | Blob URL revoked on close; fit/100%/zoom; decode-failure message. | Image file opened. |
| `SvgPreview` | Render SVG source. | SVG icons are edited as text. | `image/svg+xml` blob in `<img>`, where scripts never run. | SVG Split/Preview mode. |
| `git_file_context` | Locate an editor file in its repository. | Git commands need git's own relative path; actions hide outside a repo. | Logical path → containment → `rev-parse --show-toplevel --show-prefix`, current branch. | Editor document ready; after `omniterm:git-refresh`. |
| `git_file_history` / `GitFileHistoryModal` | File and selection history. | See who changed a file or lines and how. | `git log --follow --name-only` or `-L start,end:path`; read-only diff vs parent or working copy. | Editor right-click → File history / History of selection. |

## State and data

- Expanded dirs
- Paged entries
- Logical path
- Per-tab document model (`EditorState`, saved baseline, scroll, generation)
- Document meta (size, mtime, EOL, BOM, read-only, profile)
- Dirty and conflict state
- View mode (Code/Split/Preview)

## Errors and edge cases

- Unavailable/removed/oversize/disallowed/traversal target returns an error shown in the tab body.
- Binary content or invalid UTF-8 is refused on open; an existing binary file is never overwritten.
- A read-only file opens without save actions.
- Invalid JSON shows the error location with a Go to error action; an unterminated CSV quote is read literally from its row on.
- A preview that throws or times out returns to the code view with a notice.

## Security and invariants

- Canonical containment on every native read/write, including the parent directory when a deleted file is recreated.
- The editor's save gate equals the view gate (deny-listed kinds, key material and user exclusions stay unsavable); `write_script` keeps its script allow-list.
- HTML previews run without scripts in an opaque origin and cannot fetch network resources.
- The image read is a separate allow-list gate: it never widens the text view, edit or run gates, and SVG is only ever rendered through `<img>`.
- Preview content does not grant native authority.

## Verification

- Workspace scan/paging tests
- Safepath view/edit tests and `text_file` open/save tests (EOL, BOM, conflicts, refusals, containment)
- Editor command and IPC contract tests
- Editor tab, document hook, preview, CSV, JSON graph and worker tests
- `image_file` and `git_history` core tests, file-view command tests, image tab/preview tests, editor Git action and file history modal tests

## Source map

- `crates/app-core/src/workspace_scan.rs`
- `crates/app-core/src/workspace_scan_paging.rs`
- `crates/app-core/src/safepath.rs`
- `crates/app-core/src/text_file.rs`
- `crates/app-core/src/image_file.rs`
- `crates/app-core/src/git_history.rs`
- `src-tauri/src/file_view_commands.rs`
- `ui/components/git/GitFileHistoryModal.tsx`
- `ui/utils/imageFile.ts`
- `crates/app-protocol/src/text_file.rs`
- `src-tauri/src/text_file_commands.rs`
- `ui/components/FileBrowser.tsx`
- `ui/components/editor/`
- `ui/components/MarkdownPreview.tsx`
- `ui/utils/textFileWire.ts`
