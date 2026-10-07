# Changelog

## [v0.1.14] — 2026-10-07

### Added
- feat: add git commit inspector, diff preview modal, and editor shortcuts (@Hai Nguyen)
- **Git Commit Inspector & Diff Preview**: View commit metadata, changed files, and inline diff previews directly from the Git graph.
- **Git Favorites**: Bookmark and quickly navigate favorite repositories and branches.
- **Double Shift / Project Search**: Quickly search and open project files with Double Shift or `Ctrl+P`.
- **Editor Shortcuts & Customization**: Configure editor keymaps, code folding, and column ruler in the built-in editor.

## [Unreleased]

### Agent Quota (new bundled plugin)
- **No credentials, no network**: Quota comes only from the agents' own CLIs and Codex's session logs; no token is read and no request is made, enforced by a build-failing test. Antigravity is not monitored.
- **Profiles by launcher**: A terminal started with a profile launcher such as `claude-th` is probed and woken through that same launcher (`claude-th -p /usage`), so profiles whose directory does not follow their name are read correctly.
- **Security-scanner-safe process handling**: Suspend uses documented Win32 thread APIs instead of `ntdll!NtSuspendProcess`; other processes' memory is read only where it decides something (script hosts, the launcher's `cmd.exe`, one agent's profile variable); tests no longer copy or rename system executables. A Defender ML heuristic had flagged the previous test binary.
- **Quota lines in every agent terminal**: Terminals running Claude Code or Codex show session, weekly and (when reported) monthly quota lines, coloured by zone relative to your limit, with a draggable limit line — now labelled with its own number — and escalating lightning, fire, burning and danger animations as usage nears it. Lines adapt to narrow panes.
- **Weekly auto-hide and a usage-pace glyph**: The weekly line hides itself while under 20% is used and its reset is more than 50 hours away (a Display setting, on by default; the 5h line's tooltip still notes it). A turtle/rabbit/plane/superman glyph next to the 5h line shows whether usage is projected to land under, at, or over the limit by reset.
- **Friendly reset times**: A reset on the next calendar day reads as `tomorrow 09:30` instead of a bare countdown; every reset's tooltip also shows the absolute local date and time.
- **Global limits per agent, custom limits per terminal — draft, then Apply**: Settings → Agent Quota and the per-terminal popover both edit a local draft; nothing changes until Apply (disabled while a wake prompt is unsafe), Reset discards the draft, and an "also reset terminals with custom settings" checkbox folds in what used to be a separate "Apply to all terminals" banner.
- **Suspend at the limit**: On by default. The agent and its AI sub-agents are frozen (scripts keep running), a watchdog confirms usage has stopped rising, and the agent resumes after the reset. Turning suspend off always asks for confirmation.
- **Smart polling and wake-up**: Quota is read more often during heavy work and rarely when idle. Every open profile can be woken by hand from quick settings, or after each reset to start a new session window; a spent week is never woken.
- **Quota at an agent's first launch, read from the agent itself**: `claude -p /usage` can answer with only the "What's contributing to your limits usage?" report, leaving a new agent with no quota. The first time a profile's agent is seen (just started, not yet typed into), OmniTerm types `/usage` into it, reads the panel, closes it and gives the keyboard back — keystrokes typed meanwhile are kept and sent afterwards, and a "Reading quota…" hint explains the pause. Anything else falls back to the background `-p /usage` read.
- **Clearer quota lines**: A line now reads `[ used | remaining safe | danger zone ]`: the fill takes one colour from used ÷ limit (so moving the limit re-colours it at once), the danger zone past the limit is always drawn, the used % sits in the middle of the fill and the danger zone's size in the middle of the danger zone, in larger type.
- **Weekly line on demand**: Each terminal's quota settings have "Show weekly quota" to show the weekly line even while the global auto-hide hides it, and the global setting now reads "Auto-hide weekly quota — hide while weekly usage < N%".
- **Agent loading artwork in the header**: With Agent loading artwork on, a busy agent pane's header shows its pace artwork travelling across an activity zone that runs from the title to the header's centre. Uploads are made per slot in the built-in set; the separate "Custom artwork overrides" section is gone.
- **Loading artwork tiers follow the room left, at a readable pace**: The header artwork is now picked only by how much of the 5h limit is used — the cat up to 40%, the horse up to 70%, the airplane up to 85%, sonic past that — and each travels at its own pace (the cat very slowly, the horse slowly, the airplane a little slower than normal, sonic at the normal pace). The artwork is larger (normal fills the header row; large stands slightly taller), the numbers in a quota line are larger, and the danger zone past the limit no longer has its own striped background: it shares the track with the remaining safe range, with the limit marker between them.
- **Simpler Agent Quota settings**: The Agent Quota settings tab is now split into three groups — Agents, Quota lines and Loading artwork — shown one at a time, each next to a live preview of what it controls. Each agent is a single row with its monitor switch and a one-line summary ("5h 90% · Weekly 95% · Monthly 95% · Suspend on · Wake off"); expand it for Limits (with a preview line per window), Protection and Wake-up. Long explanations moved into tooltips. The artwork switch is now called "Agent loading artwork" and says that off shows the plain running dots. Each tier card shows its range (Slow ≤40% of limit, On-track 41–70%, Fast 71–85%, Critical >85%), and a preview animates all four tiers at the chosen speed and size, in light or dark.
- **Profiles dashboard in Agent Quota**: Quick settings → Profiles lists every profile you can start (`~/.claude` and every `claude-<name>` launcher on your PATH or in `~/.local/bin`). Press Fetch all to read each profile's 5h and weekly quota, with bars, reset times and a status per profile, and get a "Use now" suggestion with the command to type. The suggestion favours 5h room left and weekly quota that is about to reset unused, skips profiles at a limit and names the one that frees up first when none has room. Reading only happens when you fetch; nothing is polled, woken or suspended.
- **Profiles dashboard polish**: The dashboard lists Claude profiles only for now, is no longer see-through (it used a theme colour that did not exist), and can be dragged by its header to uncover what it sits on.
- **Loading artwork up to the controls, calmer and easier to see**: The activity zone now runs from the title right up to the theme button, because the header controls take only the width their buttons need. Every tier travels at half its former speed, the horse and airplane are drawn twice as large, and the artwork no longer blocks clicks on the terminal's first row.
- **Quota lines line up, in light themes too**: The 5h, weekly and monthly tracks of a strip are always the same width, whatever their reset text. The unused part of a track follows the theme — a very light grey in light mode instead of black — and numbers beside a short fill use the theme's text colour.
- **No leftover header icon setting**: The per-agent "Header icon" (custom emoji) row is gone from the Agents group: a busy header shows the loading artwork, and the agent badge always uses the agent's own logo.
- **Quick settings and a live activity-bar icon**: A pinnable activity-bar icon (lit while monitoring is on, not just while its popover is open) and `Ctrl+Alt+Q` open quick settings with per-agent switches, every open agent terminal, and wake-all / resume-all. Disabling the plugin in the Plugin Manager now stops the engine and thaws anything frozen within seconds — no app restart needed either way.

### Resumable Claude sessions
- **Interrupted-session recovery, without guessing**: OmniTerm now detects which pane runs Claude (and which profile) from its own process tree — the same detection Agent Quota uses — and resolves its session file from that profile's own project directory. No terminal output is scanned, no unvalidated session id or profile name is ever run as a command, and no prompt text is stored.
- **An interrupted pane offers to resume**: A pane restored after the app closed or was killed shows the agent, profile, folder and the exact resume command (copyable), only when a real session was found. Resuming opens a fresh pane; a live, running agent is never shown this overlay.
- **A dashboard of interrupted and bookmarked sessions**: The empty/waiting view lists resumable sessions, bookmarks first, with their work item, folder, state and relative time, plus Resume and Remove. Unbookmarked sessions expire after 14 days and are capped at 20; bookmarks never expire.
- **Bookmarks that stick**: The bookmark button sits right after the agent's title in every terminal header (single view included) and stays lit for as long as the session is bookmarked; click again to remove it. A bookmark survives its pane closing, and one clicked before Claude has saved its session is queued and applied as soon as the session id is known. Previously the 5-second pane poll overwrote every bookmark and closing the pane deleted it.
- **A Bookmarks view**: A new activity-bar panel lists bookmarked (running or saved) and interrupted sessions grouped by profile and folder, with search, Resume / Show terminal / Remove, and pinned profile + folder workspaces that open a fresh agent (for example `claude-work` in that folder) in one click.
- **Resume survives a hard kill**: Stored sessions, bookmarks and pins are also written atomically to `agent-sessions.json` in the app data folder and merged back at startup, so killing the app (Task Manager, `taskkill /F`) no longer loses the last few seconds of WebView storage. A pane recreated at startup keeps its session while `claude --resume` starts, instead of being untracked by the first poll.
- **Launcher profiles resolve their sessions**: A Claude started through a profile launcher such as `claude-work.cmd` now has its session files looked up in the folder that launcher's `CLAUDE_CONFIG_DIR` points to, not `~/.claude`, and every resume command carries its launcher/profile. OSC 7 working directories on Windows (`file://host/C:/…`) are normalized, so a pane that `cd`-ed still finds its session.
- Codex and Antigravity resume are not yet offered — Codex is detected but its session-file format still needs mapping, and Antigravity's resume syntax needs confirming; both are tracked for a follow-up.

### Terminal & Sessions
- **Restart restores layout and working directories, not processes**: OmniTerm now persists pane/tab placement plus each terminal's last working directory and recreates fresh shells on the next launch instead of resuming daemon-owned process state.
- **Process-persistence modes removed**: Removed the per-terminal Keep running, Freeze while closed, and Recover after reboot controls. New GUI PTYs always use close-with-app lifetime semantics.
- **Daemon lifetime follows the GUI**: Losing the final GUI lease terminates owned PTYs and allows the session daemon to exit, while same-app detach/reattach continues to preserve a live terminal process.
- **Retryable startup recovery**: Restored panes keep their saved cwd/layout metadata authoritative until native startup succeeds, and individual failed panes can be retried without reopening closed panes or resetting the current layout.
- **Unicode input and display in terminal panes**: Typing and IME composition (Chinese, Japanese, Vietnamese, and other non-Latin scripts) now round-trips correctly through the pane, including Windows Telex/IME composition that previously produced duplicated or garbled characters.
- **Command completion setting**: A new General setting toggles PowerShell's inline (PSReadLine) prediction on or off per the user's preference, default ON; a POSIX/UTF-8 codepage bootstrap still runs either way.
- **Stop no longer leaves garbled terminal output**: Force-killing a pane's foreground process (Stop) now clears mouse-tracking, bracketed-paste, cursor-visibility, and alt-screen modes the process left enabled, instead of leaving raw escape sequences visible in the pane.
- **Terminal header status restored to the master look**: The header shows the small oscillating running indicator again while a process or agent works (it wrongly showed the hollow "Idle" ring for busy agents), and the 88px loading GIF that made header buttons jump in and out of the overflow menu is gone.
- **Header title shows the agent's work item**: An agent pane's header now leads with the task title the agent sets on its terminal (for example `Fix header status`), with the folder as quieter context, and tabs read the same way.
- **One agent identity everywhere**: The pane header, tabs, launch page, interrupted-session overlay and Bookmarks view use the same agent badge (honouring an Agent Quota emoji), with the agent and profile named in its tooltip instead of spelled out. The footer no longer repeats the header's agent icon, status, pasted-image button or stop/clear/copy/save; it keeps location, shell, metrics and your configured footer actions, and now shows the live working directory in split panes.
- **Renewed panes stay live**: A renewed pane (plain pwsh or Claude Code) used to end up showing Error or Reconnect with its input dead: the replaced process's late "closed"/"error" was delivered to the new session under the same pane id. Messages from a replaced session are now dropped.
- **Header controls stay put**: Renew, the session picker and close sit in an anchored group at the right of each terminal header, and the status/running animation has its own fixed area next to the title, so switching between idle and processing never moves a button.
- **Latency shown as signal bars**: The footer's TCP latency uses signal bars graded by latency (good / fair / slow / poor) instead of a lightning bolt that read as a warning on a healthy link.
- **Renew lives in each terminal header, and no longer closes the tab**: The renew button moved from the top bar into every local pane's header. Renewing used to close the pane it renewed (the old process's exit triggered close-on-exit); it now reopens in place, restarts the pane's agent with its own profile even without a stored session, sends `/clear` to Claude Code (`/new` elsewhere) as a separate command and submit for the in-agent strategy, and reports failures.
- **Vietnamese Telex typing no longer loses, doubles or respawns characters**: Space, hyphen and other punctuation used to commit a Telex word early and empty the terminal's hidden input while Windows was still composing in it; Windows then re-inserted the word and it reached PowerShell or the agent twice. A single bridge now forwards every IME edit as the difference from what the terminal already has (Backspaces, then the new letters), so an edit reported twice sends nothing, compositions are sent once when Windows ends them, and the order of a word and the delimiter after it is kept.
- **Vietnamese Telex (Windows built-in) no longer duplicates text**: Typing with the Windows 10/11 Vietnamese Telex keyboard in PowerShell or an AI agent could send a word twice (`tie` + `e` arrived as `tietiê`): the IME types and corrects letters in place in the terminal's hidden input, and xterm re-sent the whole corrected text. Those edits are now forwarded exactly as typed — a correction becomes Backspaces plus the new letter — and xterm no longer sees the keystrokes the IME handles.
- **Ctrl+Alt+V script paste stays readable and editable**: The pasted block no longer draws a tinted gutter or a hint over the script's last line — both covered long lines, and stayed on top of the output (or of a `Clear-Host`) after the script ran. A thin bar marks the block only until Enter, Ctrl+C or Esc, and every line OmniTerm adds is short (the header comment says how to run it; the `Output` divider is its own tagged line), so a narrow pane no longer wraps them into PSReadLine's redraw.
- **Attachments you can find and clear**: Images and files pasted or dropped into an AI agent pane are now kept in the app's own attachments folder instead of the OS temp directory. A paperclip in the pane footer lists what that pane attached — thumbnails for images, with View and Open (for document and image types) — plus "Open attachments folder". Copying files in Explorer and pressing Ctrl+V, or dragging files onto an agent pane, now attaches them too; their stored paths are typed into the prompt. Settings → General → Attachments shows how many files are stored and how much space they take, opens the folder, and clears everything (including images older builds left in the temp directory) after a confirmation. The pane header no longer has its own pasted-image button.
- **Ctrl+Alt+V multi-line PowerShell paste, explained and marked**: Settings → Keyboard Shortcuts now explains the shortcut. The pasted block is tagged `# >>> OmniTerm…` / `# <<< end of pasted script` around your verbatim lines, marked by a thin accent gutter until it runs, and prints an `========== Output ==========` divider on a new line when it runs. Outside a local PowerShell pane (cmd, WSL, SSH, an agent) it does an ordinary paste, and Alt+V passes through to plain shells again.
- **Pane header actions reordered**: Pane header buttons now read current-directory, stop, clear, copy, detach, theme, font size, fullscreen, session picker, close — matching the intended visual grouping.
- **Theme button matches other pane header controls**: The pane header's theme-switch button no longer draws a border/outline, consistent with the other icon buttons in the same row.
- **Debug builds no longer break Node/Bun CLIs in panes**: A debug build launched from a debugger (e.g. VS Code's JS debugger) previously leaked its `NODE_OPTIONS`/`VSCODE_INSPECTOR_OPTIONS` inspector hooks into every pane's environment, causing Node/Bun-based CLIs such as Claude Code to exit immediately with no output. Debug builds now strip those variables before any session starts; production builds are unaffected.

### Reliability, Tests & Documentation
- Added integrated renderer coverage for fresh-shell reconstruction, saved-cwd restore, pending acknowledgement, targeted retry, and layout retention.
- Synchronized the terminal lifecycle, PTY detach, frontend/Rust session component specs, source inventories, README, and settings-transfer documentation with the layout/cwd-only restart model.
- Hardened the shared mock-app workspace test path so the full Rust workspace gate is deterministic on Windows.
- Added regression tests for IME/Unicode input handling, the command completion setting, the terminal interrupt mode reset, and debug-build environment stripping.
- Closed Rust branch-coverage gaps: the command-completion setting's "on" argv path was only exercised by a Windows-gated test, so Linux CI never ran it; and `session-core`'s `spawn_reader`/`acknowledge_flush` never had their poisoned-lock recovery and stale-acknowledgement branches tested. All four now have dedicated regression tests.
- Removed obsolete live freeze/resume machinery left behind after process persistence was removed; only guarded legacy Unix orphan cleanup remains, with focused coverage for identity-match, incomplete-record, and recycled-PID branches.

## [v0.1.9] — 2026-09-21

### Terminal & Sessions
- **Immediate session-preserving Stop**: Local pane Stop now snapshots the running process tree, sends ETX, terminates only the pre-existing descendants, and leaves the root shell/PTY alive for the next command. SSH Stop sends ETX directly; the delayed Force-kill escalation is gone.
- **Current-directory pane launch**: Local pane headers expose an icon action and fixed `Ctrl+Shift+N` shortcut to open the same shell in the pane's live working directory, reserving a newly exposed pane when the layout expands.
- **Current working folder status**: Pane headers and the active-session status bar resolve live cwd updates, preferring the deepest matching workspace-folder alias before falling back to the raw folder basename.
- **Persistent close-confirm preference**: “Apply to all (Don't ask again)” now persists across launches, with a General setting that can restore the connected-terminal confirmation dialog at any time.
- **Freeze while closed**: Per-session Freeze mode suspends the process tree while no GUI is attached and resumes it with buffered output replay when OmniTerm returns.
- **Close with OmniTerm remains the default lifetime**: New shells and agent sessions close with the app unless the user selects Keep running, Freeze while closed, or Recover after reboot.
- **Safer recovery bookkeeping**: Frozen-session manifests update immediately on resume and recovery avoids signaling recycled process IDs.

### Workspace & Launching
- **Default workspace selection**: General settings can choose last-used, system home, a workspace root, or a pinned folder for launches that do not specify a location.
- **Faster New Terminal folder launches**: Double-clicking a workspace folder immediately opens the default shell there, and New Terminal hover text shows the exact shell kind and directory before launch.

### Settings & UI
- **Whole-settings export/import**: Preferences, shortcuts, and custom themes can be exported in one validated envelope and imported with merge or replace semantics.
- **Pane controls use themed tooltips only**: Native button/pane `title` attributes were removed in favor of accessible labels and the application tooltip system; unlabeled buttons receive a delegated themed fallback.
- **Responsive pane actions**: The current-directory action uses a larger icon, participates in the three-dots overflow menu, and returns inline together with the other controls whenever pane width allows.
- **Sidebar label readability**: Sidebar labels remain fully readable at rest and only truncate when required by the hover interaction.

### Windowing & Layouts
- **Layout shrink compaction**: Shrinking from a larger pane layout removes empty visible slots before hiding active terminals, preserving visual order and following the focused pane when it moves.
- **Pane-geometry terminal refit**: Visible xterm instances refit immediately and again on the next paint after layout changes so canvas/text geometry settles to the final pane size.
- **App fullscreen (F11)**: OS-level fullscreen can hide application chrome while keeping the status bar visible, with Escape restoring the normal window.
- **Split panes stay contained**: Divider changes use percentage geometry and clipping instead of allowing oversized terminal canvases to create horizontal desktop scrolling.

### Reliability, Coverage & Documentation
- Hardened native image paste/session process handling and kept process interruption independent from unreliable activity probes.
- Added focused Rust branch coverage for the local session interrupt paths so the repository's 85% Rust branch gate covers the new Stop implementation.
- Local pre-push Rust checks keep Cargo build caches in the OS temp directory by default, avoiding repository-drive exhaustion while preserving an explicit `CARGO_TARGET_DIR` override.
- Synchronized session, layout, settings, frontend/Rust source inventories, and release notes with the shipped v0.1.9 behavior.


## [v0.1.8] — 2026-08-26

### Added
- feat(ui): pasted-image history viewer with pager (@the-long-ride)
- feat(ui): pane-header button opens pasted-image viewer (@the-long-ride)
- feat(ui): full-res pasted-image viewer modal (@the-long-ride)
- feat(clipboard): report saved image bytes to pane viewers (@the-long-ride)
- feat(ui): per-session pasted-image store (@the-long-ride)
- feat(plugin): always-awake status becomes switch (@the-long-ride)
- feat(ui): rename clickhouse theme to compact (@the-long-ride)
- feat(ui): new-terminal menu enter opens folder (@the-long-ride)

### Fixed
- fix(ui): keep new-terminal menu cursor visible (@the-long-ride)
- fix(ui): new-terminal menu arrows survive typing a search (@the-long-ride)
- fix(ui): latch agent title for image paste (@the-long-ride)
- fix(ui): menu arrows die after typing a search (@the-long-ride)
- fix(ui): theme menu fits short window viewports (@the-long-ride)
- fix(ui): resend pty dims when session ready (@the-long-ride)
- fix(terminal): drop trailing line from copy-last-output (@the-long-ride)
- fix(terminal): copy-last-output, pane stop, image paste per agent (@the-long-ride)

### Changed
- docs(specs): add pasted-image viewer spec, sync inventories (@the-long-ride)

### Refactored
- refactor(ui): extract ctrl+wheel font resizer from TerminalView (@the-long-ride)

### Tests
- test(ui): pin menu arrow-key event bubbling (@the-long-ride)


## [v0.1.7] — 2026-08-24

### Added
- feat: session freeze lifecycle, native auto-updater, and terminal UX batch (@Thế Long)
- feat: focused-slot reattach pulse, shortcuts bridge, API surface (@the-long-ride)
- feat: alt+click cursor positioning + pane-header copy menu (@the-long-ride)
- feat: default workspace choice for new terminals (@the-long-ride)
- feat: versioned settings export/import across four stores (@the-long-ride)
- feat: native updater release infra + settings UI hooks (@the-long-ride)
- feat: paste clipboard images into terminal agents (@the-long-ride)
- feat: folder aliases and live cwd in pane headers (@the-long-ride)
- feat: session freeze + close-with-app default (@the-long-ride)

### Fixed
- fix: align unix suspend API with ProcIndex snapshot (@the-long-ride)
- fix: detach window UX polish + stop button live flag + force-kill timer (@the-long-ride)
- fix: always-awake plugin bounded retry + jiggle improvements (@the-long-ride)
- fix: exclude trailing shell prompt from copy-last-output (terminalCopyExtract) (@the-long-ride)
- fix: gate updater plugin on OMNITERM_UPDATER_PUBKEY env var (lib.rs + update_manager) (@the-long-ride)
- fix(ui): promote detach/fullscreen out of the overflow menu (@the-long-ride)
- fix(ui): clip split panes instead of horizontal scroll (@the-long-ride)

### Changed
- docs: spec + changelog updates for shipped features (@the-long-ride)
- perf: cut redundant daemon I/O, scans and render churn (@the-long-ride)
- docs: sync freeze, default policy and pane clip specs (@the-long-ride)

### Refactored
- refactor: workspace, pty-resolve, probe, and util cleanup (@the-long-ride)
- refactor: window control, themes dir-swap retry, rdp cleanup (@the-long-ride)
- refactor: plugin host rpc + management cleanup (@the-long-ride)

### Tests
- test: cover manager state-dir failure, exclude plugin Wry instances (@the-long-ride)
- test: cover transfer/manifest error paths, exclude updater arms (@the-long-ride)
- test: always-awake poller + native entry updates (@the-long-ride)
- test: ipc + command integration coverage refresh (@the-long-ride)
- test: stop-button escalation regression coverage (@the-long-ride)
- test: settings transfer + backup section UI coverage (@the-long-ride)
- test: split oversized Rust test modules by responsibility (@the-long-ride)

### Other
- pull latest ME (@the-long-ride)


## [v0.1.6] — 2026-08-20

### Terminal & Sessions
- **Interactive link and path menu**: Modifier-clicking (Ctrl on Windows/Linux, Cmd on macOS) on detected URLs or filesystem paths opens an overlay menu to copy the link/path or open it in the default browser or OS handler. The legacy right-click action remains dedicated to copying selections and pasting.
- **Session Stop and Clear buttons**: Pane headers provide Stop (Ctrl+C) and Clear (Ctrl+L) icon buttons for active sessions, offering instant terminal clearing without polluting shell command history.
- **New terminal launcher menu**: Replaced the previous modal dialog with an inline dropdown menu accessible from the title bar, activity bar, and session tabs to quickly launch default shells, custom shells, workspace folders, or saved connections.
- **Session recovery overlay**: Displays a clear feedback overlay with a restart button when an attached terminal session disconnects or exits unexpectedly.
- **Session layout persistence**: Snapshots active tabs, view groups, and focused pane configuration to local storage so layout state automatically restores across application restarts. Local shells reopen in their last working directory, and agent sessions replay their resume command.
- **Cross-restart scrollback caching**: Stores raw PTY output in IndexedDB per session and replays it upon reconnecting, preserving terminal output history across restarts.
- **Agent-aware activity tracking**: Automatically parses OSC terminal titles to detect AI coding agents (Claude, Gemini, Aider, Cursor, etc.), differentiating autonomous agent activity and tool sub-processes from idle typing states.
- **Oscillating running indicator**: Pane headers display a smooth oscillating dot animation with ghost trails while a session is actively running, reverting to idle when work completes.
- **Responsive session controls**: Terminal control buttons dynamically measure available header and footer space, moving overflow items into a dropdown menu on narrow panes.
- **Per-terminal persistence policy menu**: Pane header and footer persistence controls open a popover menu allowing users to toggle lifetime policies between None, Window, Hybrid, and App.

### Windowing & Layouts
- **5-pane and 7-pane grid layouts**: Added Grid 5 (`Ctrl+5`) and Grid 7 (`Ctrl+7`) multi-pane layouts with orientation toggling between top-stacked and left-stacked arrangements.
- **Windows 11 window corner rounding**: Configured transparent, shadowless native window framing paired with dynamic CSS corner rounding (`useWindowRounding`) that automatically un-rounds when maximized.
- **Layout shortcut hints**: Added keyboard shortcut tooltips and quick orientation cycling across all grid modes (1 through 8 panes).

### UI Components & Primitives
- **Shared UI primitives**: Added standardized `Button`, `Keycap`, `KeycapCombo`, `Tooltip`, `SessionStatusIndicator`, and `SessionFooterBar` components with theme-adaptive styling.
- **Consolidated settings modal**: Unified settings into a single tabbed dialog (`SettingsModal`) covering General preferences, Appearance, Plugins, Updates, and Keyboard Shortcuts.
- **Workspace panel theme styling**: Styled workspace rows and secondary surfaces with dedicated theme background and sidebar tokens for clear visual hierarchy.
- **Themed global scrollbars**: Styled thin custom scrollbars matching active theme colors.

### Backend & Platform Integration
- **Safe OS path opening**: Introduced the `open_in_system` Tauri command with strict path validation that blocks URL schemes, control characters, and invalid input before invoking OS handlers.
- **Quick shell overrides**: Extended `open_quick_shell` to support renderer-supplied working directory and command overrides for seamless agent session restoration.
- **Public protocol helpers**: Exposed `cap_cwd` and `cap_command` helper functions from the protocol crate for consistent argument length-capping across launcher paths.
- **Process monitoring runtime dependency**: Moved `sysinfo` to a runtime dependency in the desktop app to ensure process-tree inspection works reliably in packaged release builds.

### Developer Experience & Tooling
- **Orphaned dev port recovery**: Added `free-dev-port.mjs` to automatically reclaim port 5173 from lingering Vite instances before starting dev servers.
- **Windows dev server stability**: Configured Vite file watching to ignore Cargo `target/` directories, preventing EBUSY file-lock crashes during build-script compilation.
- **Automated spec documentation tests**: Added validation test suites ensuring specification documents and source module inventories stay in sync with the codebase.
- **Expanded Rust test coverage**: Broadened unit and integration branch test coverage across the session daemon, client transport, and system pollers.

## [v0.1.5] — 2026-08-15

### Packaging & Release
- Resolved portable plugin host path resolution in packaged release builds.

## [v0.1.4] — 2026-08-14

### Workspace Management
- **Composite workspaces**: Supported workspaces with multiple local folder roots and nested workspace references.
- **Workspace import**: Added import support for VS Code and VSCodium `.code-workspace` and `.workspace` files while preserving local paths and names.
- **Inline folder renaming**: Enabled double-click inline renaming of workspace roots directly within the workspace tree panel.
- **Drag-and-drop hierarchy**: Added drag-and-drop support for nesting folders, moving items, and reordering sibling entries.
- **File and folder pinning**: Pinned important files and folders to the top of their parent section.
- **Filter search**: Added text filtering for selected-types and selected-files views without modifying saved selections.

### UI & Appearance
- Enhanced styling for background blur settings and waiting panes.
- Refined multi-resolution Windows app icons with a simplified front-terminal crop for crisp rendering at 16–48 px.

### Platform & Automation
- Configured GitHub Actions multiplatform release workflows for Windows portable/installer executables, Linux AppImages/debs, and macOS disk images.
- Added SSH remote URL verification to repository identity guards.

### Bug Fixes
- Validated workspace ID existence before checking folder parameters in workspace entry scans.
- Cleaned up unused variables and fixed test regressions across workspace panels and bridge contracts.

## [v0.1.3] — 2026-08-13

### Features
- Added background blur plugin support and configurable view groups for organizing terminal panes.
- Integrated repository agent skills for Claude Code, Copilot, and opencode.
- Added GitHub identity guard tooling for verifying local commit and push identities.

### Bug Fixes & Improvements
- Stabilized terminal and workspace user interface interactions.
- Established canonical repository code writing rules and size limits.

## [v0.1.2] — 2026-08-12

### Tooling & CI
- Added GitHub identity guard tooling for repository-local account locking.
- Fixed release workflow build arguments.
- Added repository code writing standards.

## [v0.1.1] — 2026-08-08

### Customization & Plugins
- Rebuilt Theme Remix around a live side-by-side dark and light mode preview.
- Migrated Always Awake plugin to a standalone contribution with its own stylesheet and Settings panel integration.

### Architecture & Testing
- Refactored Rust backend into modular workspace crates (`crates/app-core` and `crates/app-protocol`) and organized the frontend under `ui/`.
- Expanded test coverage across frontend components and plugin rejection paths (reaching 91.3% JS/TS branch coverage).
- Configured virtual display (Xvfb) for headless Linux CI test execution.

## [0.1.0] — 2026-07-31

### Core Features
- **Multi-window terminal hub**: Built offline multi-window local, SSH, and RDP terminal manager using Tauri 2 (Rust) and React.
- **PTY backend**: High-performance per-session PTY engine powered by `portable-pty` / ConPTY with xterm.js frontend rendering.
- **Detachable panes**: Moved terminal sessions into standalone OS windows with seamless re-attachment to the main window.
- **Workspace management**: Workspace panel with pinned folders, script navigation, and quick file preview.
- **Built-in editor & markdown viewer**: Syntax-highlighted file editor with `Ctrl+S` saving alongside Mermaid diagram markdown rendering.
- **Command palette**: Fuzzy search command palette (`Ctrl+K`) for rapid navigation and quick connections.
- **Theme customization**: Built-in dark and light themes with live remixing and JSON import/export.
- **Plugin architecture**: Node.js sidecar plugin host communicating via JSON-RPC 2.0 over stdio with bundled connection management plugins.

### Security & Privacy
- Zero-credential persistence architecture with no password fields, secret vaults, or credential-saving APIs.
- Suppressed all runtime logging in production release builds (`release_max_level_off`).
- Direct in-band interactive typing for SSH passwords.
- Strict Content Security Policy on renderer webviews.
- Single-instance gating routing secondary launches to the existing window.