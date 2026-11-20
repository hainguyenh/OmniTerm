//! Installing the Antigravity status line bridge into a profile's
//! `<home>/antigravity-cli/settings.json`, taking it out, and the command-line mode the CLI runs.
//!
//! Install points `statusLine` at OmniTerm, keeping the profile's earlier status line in
//! `antigravity-cli/omniterm/bridge.json`; the bridge runs it with the same input and shows its
//! output. Without an earlier line it asks the CLI to keep its built-in line (`stack_with_default`)
//! and adds a short quota line under it. Antigravity runs status lines with `cmd /c` on Windows and
//! `sh -c` elsewhere; `shell_command` builds a form that works in both.

use std::io;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

use super::agy_bridge::{agy_cli_dir, agy_status_text, agy_usage_file, agy_usage_record};
use super::bridge_settings::{
    drop_bridge_files, our_status_line, point_status_line, read_bridge, read_settings,
    restore_status_line, settings_for_install, unreadable, write_settings, Settings,
};
use super::claude_bridge::bridge_file;
use super::claude_bridge_install::{shell_command, BridgeStatus};
use super::claude_bridge_run::{
    chained_command, hide_window, now_ms, print_status, profile_arg, read_stdin, run_piped,
    write_atomic, PROFILE_FLAG,
};
use super::deps::Platform;
use super::ordered_doc::OrderedDoc;

pub const AGY_STATUSLINE_FLAG: &str = "--omniterm-agy-statusline";

fn status_command(exe: &Path, home: &Path, platform: Platform) -> Option<String> {
    let home = home.to_string_lossy().replace('\\', "/");
    shell_command(exe, &[AGY_STATUSLINE_FLAG, PROFILE_FLAG, &home], platform)
}

pub fn agy_bridge_status(home: &Path, exe: &Path, platform: Platform) -> BridgeStatus {
    let dir = agy_cli_dir(home);
    let doc = match read_settings(&dir) {
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
    let line = our_status_line(&doc, AGY_STATUSLINE_FLAG);
    let installed = line.is_some();
    BridgeStatus {
        installed,
        current: installed && line == status_command(exe, home, platform).as_deref(),
        wraps_status_line: installed
            && read_bridge(&dir)
                .get("previousStatusLine")
                .is_some_and(|value| !value.is_null()),
        unreadable: false,
    }
}

/// Point the profile's status line at this OmniTerm. Idempotent: running it again refreshes the path.
pub fn install_agy_bridge(home: &Path, exe: &Path, platform: Platform) -> io::Result<BridgeStatus> {
    let command = status_command(exe, home, platform).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the OmniTerm or profile path has characters a shell command cannot carry",
        )
    })?;
    let dir = agy_cli_dir(home);
    let mut doc = settings_for_install(&dir)?;
    let bridge = json!({ "version": 1, "exe": exe.to_string_lossy() });
    point_status_line(
        &dir,
        &mut doc,
        AGY_STATUSLINE_FLAG,
        &command,
        &["padding", "stack_with_default"],
        bridge,
    )?;
    let had_line = read_bridge(&dir)
        .get("previousStatusLine")
        .is_some_and(|value| !value.is_null());
    if let Some(Value::Object(line)) = doc.get("statusLine").cloned() {
        if !had_line && !line.contains_key("stack_with_default") {
            let mut line = line;
            line.insert("stack_with_default".to_string(), Value::Bool(true));
            doc.set("statusLine", Value::Object(line));
        }
    }
    write_settings(&dir, &doc)?;
    Ok(agy_bridge_status(home, exe, platform))
}

/// Take the bridge out: the earlier status line comes back (or none, the built-in one).
pub fn remove_agy_bridge(home: &Path, exe: &Path, platform: Platform) -> io::Result<BridgeStatus> {
    let dir = agy_cli_dir(home);
    let mut doc = match read_settings(&dir) {
        Settings::Missing => return Ok(agy_bridge_status(home, exe, platform)),
        Settings::Parsed(doc, _) => doc,
        Settings::Unreadable => return Err(unreadable()),
    };
    restore_status_line(&dir, &mut doc, AGY_STATUSLINE_FLAG);
    write_settings(&dir, &doc)?;
    drop_bridge_files(&dir, &[bridge_file(&dir), agy_usage_file(home)])?;
    Ok(agy_bridge_status(home, exe, platform))
}

/// Store the reading and produce the status line text. `chain` runs the earlier status line.
pub(crate) fn agy_statusline_output(
    home: &Path,
    input: &str,
    now: i64,
    chain: &dyn Fn(&str, &str) -> Option<String>,
) -> String {
    let record = serde_json::from_str::<Value>(input)
        .ok()
        .and_then(|doc| agy_usage_record(&doc, now));
    if let Some(record) = &record {
        // A failed write only costs freshness: the provider then asks `agy -p /usage`.
        let _ = write_atomic(&agy_usage_file(home), &record.to_string());
    }
    chained_command(&agy_cli_dir(home))
        .and_then(|command| chain(&command, input))
        .filter(|output| !output.trim().is_empty())
        .unwrap_or_else(|| format!("{}\n", agy_status_text(record.as_ref(), now)))
}

/// The shell Antigravity itself runs status lines with: `cmd /c` on Windows, `sh -c` elsewhere.
fn run_agy_chain(command: &str, input: &str) -> Option<String> {
    let mut shell = if cfg!(windows) {
        let mut shell = Command::new("cmd");
        shell.arg("/c").arg(command);
        shell
    } else {
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command);
        shell
    };
    hide_window(&mut shell);
    run_piped(shell, input)
}

/// `omniterm --omniterm-agy-statusline --profile <home>`; the process exit code (always 0).
pub fn run_agy_statusline_mode(args: &[String]) -> i32 {
    let input = read_stdin();
    let now = now_ms();
    let output = match profile_arg(args) {
        Some(home) => agy_statusline_output(&home, &input, now, &run_agy_chain),
        None => format!("{}\n", agy_status_text(None, now)),
    };
    print_status(&output)
}

#[cfg(test)]
#[path = "agy_bridge_install_tests.rs"]
mod tests;
