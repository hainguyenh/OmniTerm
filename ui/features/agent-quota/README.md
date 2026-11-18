# Agent Quota

Shows the quota of the AI agent running in each terminal — Claude Code and Codex — as coloured
lines above the pane, suspends the agent when it reaches a limit you set, and wakes a profile on
schedule so a new session window starts when you want it to.

Agent Quota is built into OmniTerm (no Node sidecar). It is listed as the built-in plugin
`omniterm.agent-quota` in the Plugins dialog, on by default; switching it off stops the quota
engine, its UI and every native quota command (the state is kept in the app settings under
`disabledBuiltinFeatures`).

## Layout

- `crates/app-core/src/agent_quota/` (Rust, Tauri-free) reads quota and sends wake-up prompts:
  providers (`claude_provider.rs`, `codex_rollout.rs`, `agy_provider.rs`), the tolerant
  `claude /usage` parser (`claude_usage.rs`, fixture corpus in `fixtures/claude-usage/`), launcher
  resolution (`launcher.rs`, `cli.rs`) and profile discovery (`profiles.rs`).
- `src-tauri/src/agent_quota/usage_commands.rs` exposes them as the Tauri commands `agent_quota_fetch_usage`,
  `agent_quota_wake`, `agent_quota_list_profiles`, `agent_quota_probe_dir` and `agent_quota_info`.
- `src-tauri/src/agent_quota/` is Rust compiled into the Tauri host: it finds the main agent and its launcher in each
  local terminal (`agent_detect.rs`, `agent_snapshot.rs`), freezes and thaws it
  (`process_suspend.rs`), and keeps the bookkeeping that guarantees a frozen agent is always thawed
  (`agent_guard.rs`, `agent_quota.rs`).
- `ui/features/agent-quota/` (this directory) is the renderer: configuration (`quotaConfig.ts`), zone and interval policy
  (`quotaPolicy.ts`, `smartInterval.ts`), the guard and wake state machines (`quotaGuard.ts`,
  `wakePolicy.ts`), the engine loop (`quotaEngine.ts`), and the UI. `usage/` keeps the
  TypeScript parsers the inline terminal probe reads the visible usage panel with.

## Where the numbers come from

| Agent | Source |
| --- | --- |
| Claude Code | The status line bridge's record (below) while it is under 10 minutes old; otherwise `claude -p /usage`, run the way the user runs the profile: through its launcher (`claude-th -p /usage`) when the terminal used one, else `claude` with the profile's `CLAUDE_CONFIG_DIR` |
| Codex | The newest `rate_limits` event in `<CODEX_HOME>/sessions/**/rollout-*.jsonl`, which Codex writes after every reply |
| Antigravity | The Antigravity status line bridge's record (below) while it is under 10 minutes old; otherwise `agy -p /usage`, run the same way as Claude's |

When an agent starts in a terminal, the engine asks Rust (`agent_quota_ensure_passive`) whether its
profile reports its quota by itself: a Claude or Antigravity profile with its bridge installed (the
call installs it when missing), or a Codex profile with a session log. Such a pane is never frozen,
trusted or typed into; the bridge and the background read keep its quota. Only the others — a
launcher with no known folder, an unreadable `settings.json`, a removed bridge, a Codex profile
before its first reply — fall back to the inline probe (`inlineUsageProbe.ts`).

No token is read and no request is made (the bridge record is what Claude Code itself shows its
status line); `agent_quota/no_network_tests.rs` fails the build if that
changes. A reading the parser cannot understand is an error, never zero usage, and an error or
stale reading never suspends anything.

## Claude status line bridge

Agent Quota installs it into every Claude profile it sees (Settings › Agent Quota › Agents › Status
line bridges lists them; Remove there keeps it out, through `<profile>/omniterm/bridge-declined`).
Per Claude profile it adds:

- `statusLine` → `omniterm --omniterm-claude-statusline --profile <dir>`. Claude Code hands it
  `rate_limits` (5-hour and 7-day used percentage and reset) after every reply; it keeps them in
  `<profile>/omniterm/claude-usage.json` and prints the profile's earlier status line (kept in
  `<profile>/omniterm/bridge.json` and run with the same input) or a short `5h 42% · 7d 13%` line.
- A `PreToolUse` hook on `Agent|Task` → `omniterm --omniterm-claude-guard --profile <dir>`. It denies
  a new sub-agent (hook JSON `permissionDecision: "deny"`) while the 5-hour or weekly window is at
  the Claude limit set here, as long as Claude is monitored and "suspend at limit" is on. Sub-agents
  already running are not stopped by it — the process guard below still covers them.

On Windows both commands are wrapped as `powershell -NoProfile -Command "& '…' | Write-Output"`, the
one form that runs the same in Git Bash and PowerShell (Claude Code uses either). The first install
keeps the untouched file as `<profile>/omniterm/settings.backup.json`; Remove restores the earlier
status line and drops only OmniTerm's entries. A record that is stale, malformed, or written before a
window's reset is ignored, and the guard allows the tool on any doubt. The installed commands name
this OmniTerm executable: the row says "update" when a profile points at another copy.

## Antigravity status line bridge

The Antigravity CLI runs `statusLine.command` from `<AGY_HOME>/antigravity-cli/settings.json`
whenever the agent's state changes and hands it a `quota` map (per bucket such as `gemini-weekly`:
`remaining_fraction`, `reset_time`). The bridge sets that command to
`omniterm --omniterm-agy-statusline --profile <AGY_HOME>`, keeps the buckets in
`antigravity-cli/omniterm/agy-usage.json`, and prints the earlier status line (run with `cmd /c` on
Windows, `sh -c` elsewhere, as the CLI does) or a short `Quota 5h 18% · wk 6%` line under the
built-in one (`stack_with_default`). Install, backup, Remove and the 10-minute freshness rule work
as for Claude. There is no sub-agent guard: the CLI's hooks have no stable home to install into.

## Profiles and launchers

A launcher is a script such as `~/.local/bin/claude-th.cmd` that sets the profile directory and
starts the agent. Rust reads it from the command line of the `cmd.exe` between the shell and the
agent and reports only its name; the native reader resolves that name again from `~/.local/bin` and
`PATH`, never a path handed to it. Without a launcher (a PowerShell function, say), the profile
directory is read from the one main agent process's `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.

## Guard behaviour

- **Suspend by default** at each window's limit; turning it off always asks for confirmation.
- The **main agent** and every **AI sub-agent** below it are frozen with documented Win32 thread
  APIs; scripts, build tools and MCP servers it started keep running.
- A **watchdog** then polls every 15–20 s for `guardMinutes`, re-scanning the tree for late
  sub-agents and threads and raising an alarm if usage still rises (optionally stopping the agent).
- The agent **resumes** after the reset plus a delay, once every window is back under its limit.
- Everything held is thawed when the feature is switched off and when the app exits.

## Overrides and wake-up

Each terminal can override its own limits and wake schedule from its popover. Edits land in a local
draft — nothing changes until Apply, so a slider drag or a half-typed prompt can never misfire a
suspend/resume decision. Reset reverts the draft to what is currently applied; Cancel does the same
and closes the popover. A missing wake override inherits the global schedule; the pane alarm icon
shows the effective state and toggles only the schedule. The applied override is sparse, in memory,
and bound to that agent process (session + pid + start time): when the agent exits or another one
starts in the terminal, the global settings apply again.

Wake-up sends one tiny prompt (`claude-th -p … --model haiku`, `codex exec --sandbox read-only …`),
either on its schedule or on demand for every open profile via "Wake all open profiles" in the quick
popover. A profile whose weekly limit is spent is never woken.

## Tests

The default test run never freezes, copies or kills a real process: the native commands are tested
against recorded process rows and recording operations. The one real suspend/resume test is opt-in:
`cargo test -p omniterm --lib agent_quota -- --ignored`.
