//! The two command-line modes Claude Code runs OmniTerm in, once the bridge is installed in a
//! profile (see claude_bridge_install.rs):
//!
//! - `--omniterm-claude-statusline --profile <dir>`: Claude Code's status line. Keeps the
//!   `rate_limits` it is handed, then prints the status line the profile had before (run with the
//!   same input) or a short quota line of its own, and keeps that text per conversation for the
//!   pane footer (statusline_store.rs).
//! - `--omniterm-claude-guard --profile <dir>`: a `PreToolUse` hook on the sub-agent tool. Denies a
//!   new sub-agent while a window is at its Agent Quota limit; allows it on any doubt.
//!
//! Both must stay fast and never fail Claude Code: every error ends in "no opinion".

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::claude_bridge::{
    blocked_reason, bridge_file, context_pct, guard_limits, last_usage_record, parse_usage_record,
    status_text, usage_file, usage_record,
};
use super::statusline_store::store_statusline;

pub const STATUSLINE_FLAG: &str = "--omniterm-claude-statusline";
pub const GUARD_FLAG: &str = "--omniterm-claude-guard";
pub(crate) const PROFILE_FLAG: &str = "--profile";
/// The tools that start a sub-agent: `Agent` today, `Task` in older Claude Code versions.
pub(crate) const SUB_AGENT_TOOLS: [&str; 2] = ["Agent", "Task"];
/// Longest the chained status line may take; Claude Code cancels a slow one anyway.
const CHAIN_TIMEOUT: Duration = Duration::from_secs(5);
/// Input above this is not a status line or hook payload.
const MAX_INPUT: u64 = 4 * 1024 * 1024;

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

/// The `--profile <dir>` argument.
pub(crate) fn profile_arg(args: &[String]) -> Option<PathBuf> {
    let index = args.iter().position(|arg| arg == PROFILE_FLAG)?;
    args.get(index + 1)
        .filter(|value| !value.trim().is_empty() && !value.starts_with("--"))
        .map(PathBuf::from)
}

pub(crate) fn read_stdin() -> String {
    let mut input = String::new();
    // A broken pipe is an empty input: the modes then fall back to their defaults.
    let _ = io::stdin().take(MAX_INPUT).read_to_string(&mut input);
    input
}

/// Print `output` as the status line; the process exit code.
pub(crate) fn print_status(output: &str) -> i32 {
    let mut stdout = io::stdout();
    let _ = stdout.write_all(output.as_bytes());
    let _ = stdout.flush();
    0
}

/// Write through a sibling temp file and a rename, so a reader never sees half a record.
pub(crate) fn write_atomic(file: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, file).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// The status line command the profile had before the bridge, kept in `bridge.json`.
pub(crate) fn chained_command(profile: &Path) -> Option<String> {
    let text = std::fs::read_to_string(bridge_file(profile)).ok()?;
    let doc: Value = serde_json::from_str(&text).ok()?;
    doc.get("previousStatusLine")?
        .get("command")?
        .as_str()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .map(str::to_string)
}

/// Store the reading and produce the status line text. `chain` runs the earlier status line.
pub(crate) fn statusline_output(
    profile: &Path,
    input: &str,
    now: i64,
    chain: &dyn Fn(&str, &str) -> Option<String>,
) -> String {
    let doc = serde_json::from_str::<Value>(input).ok();
    let record = doc.as_ref().and_then(|doc| usage_record(doc, now));
    let usage = usage_file(profile);
    if let Some(record) = &record {
        // A failed write only costs freshness: the provider then asks the CLI.
        let _ = write_atomic(&usage, &record.to_string());
    }
    let context = doc.as_ref().and_then(context_pct);
    let output = chained_command(profile)
        .and_then(|command| chain(&command, input))
        .filter(|output| !output.trim().is_empty())
        .unwrap_or_else(|| {
            // Before the session's first reply the input has no rate limits: the line shows what
            // the profile reported last, as long as one of its windows still holds.
            let reading = std::fs::read_to_string(&usage)
                .ok()
                .and_then(|raw| last_usage_record(&raw, now));
            format!("{}\n", status_text(reading.as_ref(), context))
        });
    // The pane footer shows this text; a failed write only leaves the footer on the quota.
    let _ = store_statusline(profile, doc.as_ref(), &output, context, now);
    output
}

/// The settings file of the app that installed the bridge, as `bridge.json` records it.
fn app_settings_text(profile: &Path) -> Option<String> {
    let text = std::fs::read_to_string(bridge_file(profile)).ok()?;
    let doc: Value = serde_json::from_str(&text).ok()?;
    let path = doc.get("appSettings")?.as_str()?;
    std::fs::read_to_string(path).ok()
}

/// The hook's decision for one `PreToolUse` input: the reason to deny, or `None` to stay silent.
pub(crate) fn guard_reason(profile: &Path, input: &str, now: i64) -> Option<String> {
    let doc: Value = serde_json::from_str(input).ok()?;
    let tool = doc.get("tool_name")?.as_str()?;
    if !SUB_AGENT_TOOLS.contains(&tool) {
        return None;
    }
    let limits = guard_limits(app_settings_text(profile).as_deref())?;
    let record = std::fs::read_to_string(usage_file(profile)).ok()?;
    let snapshot = parse_usage_record(&record, now)?;
    blocked_reason(&snapshot, limits)
}

/// The JSON a `PreToolUse` hook prints to deny a tool. Exit code 2 would do the same, but a shell
/// wrapper (PowerShell `-Command`) does not pass a native exit code through; JSON on stdout does.
pub(crate) fn deny_output(reason: &str) -> String {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })
    .to_string()
}

/// The shell Claude Code itself runs status lines with: Git Bash on Windows when it is installed,
/// else PowerShell; `sh` elsewhere.
fn chain_shell(command: &str) -> Command {
    if !cfg!(windows) {
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command);
        return shell;
    }
    let bash = std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("ProgramFiles")
                .map(|dir| PathBuf::from(dir).join("Git").join("bin").join("bash.exe"))
        })
        .filter(|path| path.is_file());
    let mut shell = match bash {
        Some(bash) => {
            let mut shell = Command::new(bash);
            shell.arg("-c").arg(command);
            shell
        }
        None => {
            let mut shell = Command::new("powershell.exe");
            shell.args(["-NoProfile", "-NonInteractive", "-Command", command]);
            shell
        }
    };
    hide_window(&mut shell);
    shell
}

#[cfg(windows)]
pub(crate) fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // OmniTerm is a GUI-subsystem program: without this, a console child would open a window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_window(_command: &mut Command) {}

/// Run the earlier status line with the same input; its stdout, or `None` on failure or timeout.
fn run_chain(command: &str, input: &str) -> Option<String> {
    run_piped(chain_shell(command), input)
}

/// Run `shell` with `input` on stdin; its stdout, or `None` on failure or after the chain timeout.
pub(crate) fn run_piped(mut shell: Command, input: &str) -> Option<String> {
    let mut child = shell
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let payload = input.to_string();
    thread::spawn(move || {
        let _ = stdin.write_all(payload.as_bytes());
    });
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        output
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return reader.join().ok(),
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if started.elapsed() >= CHAIN_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(15)),
        }
    }
}

/// `omniterm --omniterm-claude-statusline --profile <dir>`; the process exit code.
pub fn run_statusline_mode(args: &[String]) -> i32 {
    let input = read_stdin();
    let output = match profile_arg(args) {
        Some(profile) => statusline_output(&profile, &input, now_ms(), &run_chain),
        None => format!("{}\n", status_text(None, None)),
    };
    print_status(&output)
}

/// `omniterm --omniterm-claude-guard --profile <dir>`; the process exit code (always 0).
pub fn run_guard_mode(args: &[String]) -> i32 {
    let input = read_stdin();
    if let Some(reason) =
        profile_arg(args).and_then(|profile| guard_reason(&profile, &input, now_ms()))
    {
        let mut stdout = io::stdout();
        let _ = writeln!(stdout, "{}", deny_output(&reason));
        let _ = stdout.flush();
    }
    0
}

#[cfg(test)]
#[path = "claude_bridge_run_tests.rs"]
mod tests;
