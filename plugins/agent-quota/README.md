# Agent Quota

Shows the quota of the AI agent running in each terminal — Claude Code and Codex — as coloured
lines above the pane, suspends the agent when it reaches a limit you set, and wakes a profile on
schedule so a new session window starts when you want it to.

## Layout

- `src/` is the Node sidecar: it reads quota (`agentQuota.fetchUsage`) and sends wake-up prompts
  (`agentQuota.wake`). Providers live in `src/providers/`; `src/claudeUsageParser.ts` is the
  tolerant `claude /usage` parser, with its fixture corpus in `__tests__/fixtures/claude-usage/`;
  `src/launcher.ts` resolves profile launchers.
- `native/` is Rust compiled into the Tauri host: it finds the main agent and its launcher in each
  local terminal (`agent_detect.rs`, `agent_snapshot.rs`), freezes and thaws it
  (`process_suspend.rs`), and keeps the bookkeeping that guarantees a frozen agent is always thawed
  (`agent_guard.rs`, `agent_quota.rs`).
- `app/` is the renderer: configuration (`quotaConfig.ts`), zone and interval policy
  (`quotaPolicy.ts`, `smartInterval.ts`), the guard and wake state machines (`quotaGuard.ts`,
  `wakePolicy.ts`), the engine loop (`quotaEngine.ts`), and the UI.

## Where the numbers come from

| Agent | Source |
| --- | --- |
| Claude Code | `claude -p /usage`, run the way the user runs the profile: through its launcher (`claude-th -p /usage`) when the terminal used one, else `claude` with the profile's `CLAUDE_CONFIG_DIR` |
| Codex | The newest `rate_limits` event in `<CODEX_HOME>/sessions/**/rollout-*.jsonl`, which Codex writes after every reply |

No token is read and no request is made; `__tests__/noCredentials.test.ts` fails the build if that
changes. A reading the parser cannot understand is an error, never zero usage, and an error or
stale reading never suspends anything.

## Profiles and launchers

A launcher is a script such as `~/.local/bin/claude-th.cmd` that sets the profile directory and
starts the agent. Rust reads it from the command line of the `cmd.exe` between the shell and the
agent and reports only its name; the sidecar resolves that name again from `~/.local/bin` and
`PATH`, never a path handed to it. Without a launcher (a PowerShell function, say), the profile
directory is read from the one main agent process's `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.

## Guard behaviour

- **Suspend by default** at each window's limit; turning it off always asks for confirmation.
- The **main agent** and every **AI sub-agent** below it are frozen with documented Win32 thread
  APIs; scripts, build tools and MCP servers it started keep running.
- A **watchdog** then polls every 15–20 s for `guardMinutes`, re-scanning the tree for late
  sub-agents and threads and raising an alarm if usage still rises (optionally stopping the agent).
- The agent **resumes** after the reset plus a delay, once every window is back under its limit.
- Everything held is thawed when the plugin stops and when the app exits.

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
