//! Installing the Claude status line bridge into a profile's `settings.json`, and taking it out.
//!
//! Install points `statusLine` at OmniTerm (keeping the profile's earlier status line in
//! `<profile>/omniterm/bridge.json`, which the bridge then runs and shows) and adds a `PreToolUse`
//! hook on the sub-agent tools. The first install keeps a copy of the untouched file as
//! `<profile>/omniterm/settings.backup.json`. Remove restores the earlier status line and drops only
//! the entries OmniTerm added. A `settings.json` that is not valid JSON is never written.
//!
//! The commands are shell strings, as Claude Code runs them through Git Bash or PowerShell on
//! Windows (`sh` elsewhere); see `shell_command` for the one form that works in both.

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use super::bridge_settings::{
    command_of, drop_bridge_files, is_ours, our_status_line, point_status_line, read_bridge,
    read_settings, restore_status_line, settings_for_install, unreadable, write_settings, Settings,
};
use super::claude_bridge::{bridge_file, usage_file};
use super::claude_bridge_run::{GUARD_FLAG, PROFILE_FLAG, STATUSLINE_FLAG, SUB_AGENT_TOOLS};
use super::deps::Platform;
use super::ordered_doc::OrderedDoc;

/// Seconds Claude Code waits for the guard before it lets the tool run.
const GUARD_TIMEOUT_SECONDS: u64 = 10;

/// What the settings page shows for one profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// Both the status line and the guard hook point at an OmniTerm.
    pub installed: bool,
    /// They point at this OmniTerm; `false` while installed means another copy (an older install).
    pub current: bool,
    /// The bridge shows a status line the profile had before.
    pub wraps_status_line: bool,
    /// `settings.json` exists but is not a JSON object: it is left alone.
    pub unreadable: bool,
}

fn is_plain(token: &str) -> bool {
    !token.is_empty()
        && token.chars().all(|c| {
            c.is_alphanumeric() || matches!(c, '/' | ':' | '.' | '_' | '-' | '+' | '@' | ',')
        })
}

/// One shell string running `exe` with `args`, or `None` for a path no shell form can carry.
///
/// On Windows the program is wrapped in `powershell -Command "& '…' … | Write-Output"`: it reads the
/// same in Git Bash and PowerShell (whichever Claude Code picked), and the pipe makes PowerShell wait
/// for a GUI-subsystem program and pass its output on. Characters Git Bash would expand inside the
/// double quotes are refused rather than escaped, and so is `%`, which `cmd /c` (Antigravity's shell
/// on Windows) expands even inside double quotes.
pub(crate) fn shell_command(exe: &Path, args: &[&str], platform: Platform) -> Option<String> {
    let program = exe.to_string_lossy().replace('\\', "/");
    let tokens: Vec<&str> = std::iter::once(program.as_str())
        .chain(args.iter().copied())
        .collect();
    match platform {
        Platform::Windows => {
            if tokens
                .iter()
                .any(|token| token.contains(['"', '$', '`', '\\', '\n', '\r', '%']))
            {
                return None;
            }
            let quoted: Vec<String> = tokens
                .iter()
                .map(|token| format!("'{}'", token.replace('\'', "''")))
                .collect();
            Some(format!(
                "powershell -NoProfile -NonInteractive -Command \"& {} | Write-Output\"",
                quoted.join(" ")
            ))
        }
        Platform::Unix => Some(
            tokens
                .iter()
                .map(|token| {
                    if is_plain(token) {
                        (*token).to_string()
                    } else {
                        format!("'{}'", token.replace('\'', "'\\''"))
                    }
                })
                .collect::<Vec<_>>()
                .join(" "),
        ),
    }
}

fn bridge_commands(exe: &Path, profile_dir: &Path, platform: Platform) -> Option<(String, String)> {
    let profile = profile_dir.to_string_lossy().replace('\\', "/");
    Some((
        shell_command(exe, &[STATUSLINE_FLAG, PROFILE_FLAG, &profile], platform)?,
        shell_command(exe, &[GUARD_FLAG, PROFILE_FLAG, &profile], platform)?,
    ))
}

/// The `PreToolUse` groups with every OmniTerm guard taken out (and groups left empty dropped).
fn without_guard(groups: &[Value]) -> Vec<Value> {
    groups
        .iter()
        .filter_map(|group| {
            let Some(hooks) = group.get("hooks").and_then(Value::as_array) else {
                return Some(group.clone());
            };
            let kept: Vec<Value> = hooks
                .iter()
                .filter(|hook| !is_ours(hook, GUARD_FLAG))
                .cloned()
                .collect();
            if kept.len() == hooks.len() {
                return Some(group.clone());
            }
            let mut group = group.clone();
            (!kept.is_empty()).then(|| {
                group["hooks"] = Value::Array(kept);
                group
            })
        })
        .collect()
}

fn guard_commands(doc: &OrderedDoc) -> Vec<String> {
    doc.get("hooks")
        .and_then(|hooks| hooks.get("PreToolUse"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|hook| is_ours(hook, GUARD_FLAG))
        .filter_map(command_of)
        .map(str::to_string)
        .collect()
}

fn set_guard(doc: &mut OrderedDoc, command: Option<&str>) {
    let mut hooks = doc
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let groups = hooks
        .get("PreToolUse")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut groups = without_guard(&groups);
    if let Some(command) = command {
        groups.push(json!({
            "matcher": SUB_AGENT_TOOLS.join("|"),
            "hooks": [{ "type": "command", "command": command, "timeout": GUARD_TIMEOUT_SECONDS }],
        }));
    }
    if groups.is_empty() {
        hooks.remove("PreToolUse");
    } else {
        hooks.insert("PreToolUse".to_string(), Value::Array(groups));
    }
    if hooks.is_empty() {
        doc.remove("hooks");
    } else {
        doc.set("hooks", Value::Object(hooks));
    }
}

pub fn bridge_status(profile_dir: &Path, exe: &Path, platform: Platform) -> BridgeStatus {
    let doc = match read_settings(profile_dir) {
        Settings::Missing => OrderedDoc::default(),
        Settings::Parsed(doc, _) => doc,
        Settings::Unreadable => {
            return BridgeStatus {
                installed: false,
                current: false,
                wraps_status_line: false,
                unreadable: true,
            }
        }
    };
    let status_line = our_status_line(&doc, STATUSLINE_FLAG);
    let guards = guard_commands(&doc);
    let installed = status_line.is_some() && !guards.is_empty();
    let expected = bridge_commands(exe, profile_dir, platform);
    let current = installed
        && expected.is_some_and(|(status, guard)| {
            status_line == Some(status.as_str()) && guards.contains(&guard)
        });
    BridgeStatus {
        installed,
        current,
        wraps_status_line: installed
            && read_bridge(profile_dir)
                .get("previousStatusLine")
                .is_some_and(|value| !value.is_null()),
        unreadable: false,
    }
}

/// Point the profile at this OmniTerm. Idempotent: running it again refreshes the paths only.
pub fn install_bridge(
    profile_dir: &Path,
    exe: &Path,
    app_settings: &Path,
    platform: Platform,
) -> io::Result<BridgeStatus> {
    let (status_command, guard_command) =
        bridge_commands(exe, profile_dir, platform).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "the OmniTerm or profile path has characters a shell command cannot carry",
            )
        })?;
    let mut doc = settings_for_install(profile_dir)?;
    let bridge = json!({
        "version": 1,
        "exe": exe.to_string_lossy(),
        "appSettings": app_settings.to_string_lossy(),
    });
    point_status_line(
        profile_dir,
        &mut doc,
        STATUSLINE_FLAG,
        &status_command,
        &["padding", "refreshInterval"],
        bridge,
    )?;
    set_guard(&mut doc, Some(&guard_command));
    write_settings(profile_dir, &doc)?;
    Ok(bridge_status(profile_dir, exe, platform))
}

/// Take the bridge out: the earlier status line comes back and only OmniTerm's hook is dropped.
pub fn remove_bridge(
    profile_dir: &Path,
    exe: &Path,
    platform: Platform,
) -> io::Result<BridgeStatus> {
    let mut doc = match read_settings(profile_dir) {
        Settings::Missing => return Ok(bridge_status(profile_dir, exe, platform)),
        Settings::Parsed(doc, _) => doc,
        Settings::Unreadable => return Err(unreadable()),
    };
    restore_status_line(profile_dir, &mut doc, STATUSLINE_FLAG);
    set_guard(&mut doc, None);
    write_settings(profile_dir, &doc)?;
    drop_bridge_files(
        profile_dir,
        &[bridge_file(profile_dir), usage_file(profile_dir)],
    )?;
    Ok(bridge_status(profile_dir, exe, platform))
}

/// The profile directory a request names, refusing anything but an absolute path.
pub fn bridge_profile_dir(value: &str) -> Option<PathBuf> {
    let path = PathBuf::from(value.trim());
    (path.is_absolute() && value.len() <= 1024).then_some(path)
}

#[cfg(test)]
#[path = "claude_bridge_install_tests.rs"]
mod tests;
