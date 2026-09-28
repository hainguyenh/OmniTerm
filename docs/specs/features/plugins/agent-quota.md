---
id: feature-plugin-agent-quota
status: current
area: plugins
navigation: "Settings > Agent Quota; activity bar quick settings; pane quota strip"
platforms:
  - desktop
  - tauri
tags:
  - plugins
  - ai-agents
  - quota
  - sessions
related:
  - feature-plugin-lifecycle-runtime
  - feature-settings-themes-updates
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Plugin Agent Quota

## Description

The bundled Agent Quota plugin shows the quota of the AI agent (Claude Code, Codex) running in each local terminal, suspends the agent at user-set limits, and wakes open profiles on schedule. It reads no credential and makes no network request.

## What

A quota strip above each pane with one line per quota window (session, weekly, monthly), coloured by zone relative to the limit, with a draggable limit marker labelled with its own number. The weekly line hides itself while usage is low and its reset is distant; a pace glyph (turtle/rabbit/plane/superman) next to the 5-hour line shows whether usage is projected to land under, at, or over the limit by reset. Resets read as a friendly `tomorrow HH:MM` on the next calendar day, a plain countdown otherwise, always with the absolute time in the tooltip. A Settings tab holds the global configuration per agent; an activity-bar icon (pinnable, lit while monitoring is on) and `Ctrl+Alt+Q` open quick settings. Per-terminal overrides apply only to that terminal's current agent process.

## Why

Agents spend a shared account quota quickly and silently. Seeing the quota where the agent runs, and freezing the agent before it crosses a limit, protects quota and paid credits without leaving the terminal.

## How

- Rust (`plugins/agent-quota/native`, compiled into `src-tauri`) walks each local session's process tree by name to find the main agent, reads the launcher from the `cmd.exe` that started it (or, failing that, the one agent's profile variable), and freezes/thaws/stops processes on request after re-verifying them, using documented thread APIs.
- The Node sidecar (`plugins/agent-quota/src`) reads quota per profile: `claude -p /usage` through the profile's launcher (`claude-th -p /usage`) or `claude` with `CLAUDE_CONFIG_DIR`; Codex from the `rate_limits` it writes into its own rollout logs.
- The renderer engine (`plugins/agent-quota/app/quotaEngine.ts`) detects every 5 s, fetches each active profile on its smart interval, steps the guard state machine and schedules wakes.
- When a new agent process appears in a terminal — a launch or a resume — at most 30 s old and not typed into since its start second, the inline probe (`inlineUsageProbe.ts`) freezes the pane (input held, pane veiled), types the agent's own command (`/usage` for Claude and Antigravity, `/status` for Codex), parses what it adds to the rendered screen, closes the panel with Esc (not for Codex, which prints `/status` into its history) and releases the pane with anything typed meanwhile. A resume picker or first-run dialog on screen releases the keyboard at once; the probe asks only after it closes and only if nothing was typed after that. A new profile's background read waits up to 20 s for the probe; a failed probe falls back to it.
- Profiles are keyed by their directory, so a launcher terminal and a plain terminal on the same directory are one profile (named and read through the launcher); a launcher is keyed by its name only while Rust knows no more than the agent's default directory.

## When

The plugin runs only while it is installed and enabled and answers `agentQuota.info`, re-checked on a slow cadence after the first answer — enabling or disabling it in the Plugin Manager takes effect within seconds, with no app restart needed either way. Only local terminals are monitored (SSH/RDP agents run elsewhere; WSL processes are invisible to the host). Antigravity is not monitored. Quota is read only for *active* profiles: those with an open terminal running that agent.

## Behavior

- Zones are fractions of the limit: calm < 50 %, watch < 70 %, warm < 80 % (lightning animation), hot < 90 % (fire), critical < 100 % (burning), over ≥ limit (danger). Animations stop under reduced motion or when disabled.
- Suspend is on by default. At a fresh reading at or over any limit the main agent and its AI sub-agents are frozen; a watchdog then polls every 15–20 s for `guardMinutes`, re-scans for late sub-agents, and after two rising readings raises a danger notice (and, if configured, stops the agent at `hardStopAtPct`).
- Auto-resume happens after the triggering reset plus `resumeDelayMinutes` once every window is under its limit, or at once on an early reset. "Resume anyway" thaws immediately and suppresses re-suspension until the window resets.
- Turning suspend off (globally, for all agents, or for one terminal) always requires a danger confirmation; with suspend off a limit only produces one notice per window.
- Wake-up (`afterReset` or `timeOfDay`) sends one tiny prompt through the same launcher. Each terminal may inherit the global wake schedule or override it in its own popover; its pane icon shows that effective enabled state and only toggles the schedule. It applies to suspended profiles too, and is skipped only when the weekly limit is spent or the profile is not active. Deliberate manual wake for every open profile remains available from quick settings ("Wake all open profiles").
- The poll interval follows usage history: bands by pressure (10–15 s at ≥ 90 % of the limit up to 140–180 s below 70 %), a 20 s re-check after a jump of 6 points, a burn-rate projection that checks four times before the limit, doubled intervals for idle profiles, and exponential back-off after errors.

## Functionalities

- Global enable, per-agent enable, per-window limits, suspend, auto-resume, resume delay, watchdog length, optional hard stop, wake schedule and prompt. Edits land in a draft; Apply commits them (disabled while a wake prompt is unsafe), Reset reverts the draft, and an optional "also reset terminals with custom settings" checkbox clears overrides in the same action.
- Display: line size (thin/normal/thick), which lines (every line of a strip shares one grid, so the 5h, weekly and monthly tracks are the same width; the unused track is the pane background a shade darker — near-black in dark themes, very light grey in light ones), auto-hide the weekly line when plenty remains, which icons (agent, custom/global badge, reset countdown, wake button, suspended indicator), warning animations, the pace glyph, and pinning to the activity bar.
- Per-terminal popover: limits, suspend, auto-resume, wake-up enable/mode/time/delay/prompt, resume-while-held. Same draft → Apply/Reset/Cancel; "Reset to global" clears the draft back to inheriting global settings.
- Quick settings: global and per-agent switches, suspend-all switch, every open agent terminal with its lines, wake all, resume all, refresh, open settings.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `agent_detect::classify` / `detect_main_agent` / `launcher_name` | Name the agent, its launcher and profile. | Quota is per account profile; overrides are per agent process. | Pick the agent nearest the shell; take the launcher from its `cmd.exe` ancestor; else read `CLAUDE_CONFIG_DIR` / `CODEX_HOME` of that one process. | Every detect (5 s). |
| `agent_snapshot::tree_rows` / `fill_command_lines` / `fill_profile_env` | Read processes in phases. | Cross-process memory reads look like malware; keep them to what decides something. | Names for the tree; command lines for script hosts and launcher hosts; environment for one agent. | Every detect / action. |
| `agent_detect::suspend_targets` | Choose what to freeze. | Sub-agents spend quota; scripts do not. | Main agent plus AI-classified descendants only. | Suspend and watchdog re-scan. |
| `agent_guard::suspend_session` / `resume_held` / `terminate_session` | Freeze, thaw, stop. | The renderer must not signal arbitrary pids. | Re-verify pid + start time against a fresh snapshot; hold thread ids and release exactly those. | Guard actions. |
| `process_suspend::{suspend, resume, terminate}` | Platform freeze/thaw. | Documented APIs only. | Toolhelp thread snapshot + `SuspendThread`/`ResumeThread`; SIGSTOP/SIGCONT on Unix. | Guard actions. |
| `agent_quota_detect` / `_suspend` / `_resume` / `_resume_all` / `_terminate` | Tauri commands. | Renderer entry points. | Blocking work off the async runtime; `AgentQuotaState::resume_all` also runs on app exit. | Engine loop, UI actions, exit. |
| `parseClaudeUsage` / `parseResetText` | Read `claude /usage`. | The CLI's wording drifts between releases. | Label-anchored lines, used/left/remaining, zone-aware reset times, validation. | Each Claude probe. |
| `parseCodexStatus` | Read Codex's interactive `/status` card. | Codex's limits exist on disk only after its first reply. | Drops the session-id and context-window rows, then the `/usage` label rules on the 5h and weekly rows. | Each inline Codex probe. |
| `fetchClaudeUsage` / `fetchCodexUsage` / `agentCommand` | Read quota per profile. | One normalised snapshot per agent, no credentials. | CLI via launcher or profile variable; Codex rollout log. | Engine fetch. |
| `wakeAgent` | Start a new session window. | Align the 5-hour window with the user's day. | One validated prompt through the agent's CLI in the temp directory. | Scheduled or manual wake. |
| `QuotaEngine` / `runGuards` | Loop, fetch, guard, wake. | Keep scheduling apart from rules. | Injected API and clock; per-profile smart interval. | While the plugin is present. |
| `stepGuard` / `nextInterval` / `dueWake` | Pure policies. | Testable decisions. | State machines over readings, history and time. | After each reading / tick. |
| `formatReset` / `paceTier` / `shouldHideWeekly` | Friendly reset text, usage pace, weekly auto-hide. | Read the state at a glance without doing the math. | `tomorrow HH:MM` on the next calendar day else a countdown; projected usage vs. limit over the 5h window; hide weekly while its usage is under the auto-hide threshold (default 60%). | Pane render. |
| `useCoarseNow` | The shared clock, bucketed. | Many pane strips must not re-render every second. | Selects `state.now` rounded to 30s, or 1s once a given deadline is under two minutes away. | Pane / footer render. |
| `parseQuotaConfig` / `effectiveConfig` / `pruneOverride` | Settings and overrides. | Validated, sparse configuration. | Defaults for invalid fields; overrides only while they differ. | Settings load and edits. |
| `QuotaPaneLines` / `QuotaLine` / `SuspendedOverlay` | Per-pane UI. | Quota where the agent runs. | Zone bands, fill, draggable marker, container queries; the wake icon toggles the terminal schedule without launching a child process. | Pane render. |
| `AgentQuotaSettings` / `QuotaQuickPopover` / `QuotaOverridePopover` | Configuration UI. | Global, quick and per-terminal control. | Save through `saveConfig`; danger confirmation for suspend off. The settings tab groups Agents / Quota lines / Loading artwork (`AgentSettingsCard`, `QuotaLinesSettings`, `LoadingArtSettings`, `settingsControls`), each with a live preview. | User action. |
| `headerLoadingTier` / `HeaderBusyArt` | Busy-header artwork tier. | Show at a glance how much room is left while the agent works. | Used ÷ 5h limit: ≤40% slow (cat), ≤70% on track (horse), ≤85% fast (airplane), else critical (sonic); each tier travels at its own calm pace (28 s / 18 s / 12 s / 7.6 s per round trip), the horse and airplane drawn at twice the base size. The activity zone runs from the title to the first header control (the theme button); the controls take only the width their buttons need, at most half the header. | Busy agent pane with artwork on. |
| `profileDashboard` / `adviseProfiles` / `QuotaProfilesDashboard` | Profiles dashboard. | Reflect the current active Claude profile quotas without a second discovery/fetch path. | Claude only for now: read the engine's active profile map, which is already keyed and updated by terminal detection; show one row per active profile, reuse the engine's latest good/error reading, rank limited/ready rows for display, and omit inactive launcher profiles and the “Use now” banner. View only; the dialog is opaque and moves by its header. | Quick settings → Profiles. |

## State and data

- Global configuration persists once under `settings.agentQuota` and is validated by `parseQuotaConfig` on every read.
- Overrides, guard state, readings and wake memory live in the renderer's module store (`quotaStore.ts`), never on disk. Overrides are keyed by instance (`session:pid:startTime`) and dropped when the instance disappears.
- Native keeps only the processes it froze, per session, to thaw exactly those.

## Errors and edge cases

- An unparsed `/usage` output is retried once; a failure keeps the last good reading on screen, dimmed, and a redacted sample goes to the diagnostics log.
- Codex before its first reply has no rollout reading yet and reports that plainly; windows whose reset has passed since the last reply are dropped.
- A suspend that freezes nothing reverts the guard to active, reports the error and retries after 30 s.
- A reset time that has passed is kept as the resume anchor even though newer readings show the next window's reset.
- A stale suspend or resume request (the pid now belongs to another process, or another agent runs in the terminal) is refused.
- A launcher name that does not resolve from `~/.local/bin` or `PATH` falls back to the agent CLI with the profile variable.

## Security and invariants

- The renderer never names a process directly: every freeze, thaw or stop re-verifies the process as the session's current main agent (or its sub-agent) by pid and start time.
- Nothing held stays frozen: thawed on resume, on instance change, when the guard is switched off, when the plugin stops, and on app exit.
- No token or credential file is read and no network request is made (enforced by `__tests__/noCredentials.test.ts`). Only `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are read, from one agent process, and only when its launcher is unknown.
- A launcher reaches the sidecar as a bare validated name and is resolved there; no path from the renderer is executed.
- Tests never copy, rename or freeze real processes by default (`scripts/__tests__/no-system-binary-copies.test.mjs`).
- The wake prompt is restricted to letters, digits and plain punctuation, and `.cmd` shims refuse shell metacharacters; Apply refuses to save an unsafe draft, and `parseQuotaConfig` refuses one read back from disk.
- Stale or failed readings never suspend and never resume.

## Verification

- Rust: `cargo test -p omniterm --lib agent_quota` (classification, launchers, phased reads, guard bookkeeping, commands over recorded rows); `-- --ignored` adds one real suspend/resume of an unrenamed child.
- JS: `pnpm exec vitest run plugins/agent-quota` (parser corpus, providers with fakes, no-credentials guard, guard/interval/wake state machines, engine, components).
- Manual: run `claude-th` in a pane and compare the strip with `claude-th -p /usage`; drag the limit below usage, confirm freeze → guard → resume; exit and start `codex` in the same pane and confirm the override is gone. Edit a limit in the popover or Settings and confirm nothing changes until Apply; disable the plugin in the Plugin Manager and confirm the icon and any freeze clear within seconds, with no restart.
