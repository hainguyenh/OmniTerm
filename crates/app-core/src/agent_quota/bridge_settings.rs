//! What the Claude and Antigravity status line bridges share when they edit an agent's
//! `settings.json`: reading it without ever rewriting a file that is not valid JSON, pointing its
//! `statusLine` at OmniTerm while keeping the earlier one in `omniterm/bridge.json`, and the marker a
//! user leaves by removing a bridge, so OmniTerm does not put it back by itself.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::claude_bridge::{bridge_file, BRIDGE_DIR};
use super::claude_bridge_run::write_atomic;
use super::ordered_doc::OrderedDoc;

const SETTINGS_FILE: &str = "settings.json";
const BACKUP_FILE: &str = "settings.backup.json";
/// Left by a removal from Settings: the automatic install skips the profile until a manual one.
const DECLINED_FILE: &str = "bridge-declined";

pub(crate) fn command_of(value: &Value) -> Option<&str> {
    value.get("command").and_then(Value::as_str)
}

pub(crate) fn is_ours(value: &Value, flag: &str) -> bool {
    command_of(value).is_some_and(|command| command.contains(flag))
}

pub(crate) enum Settings {
    Missing,
    Parsed(OrderedDoc, String),
    Unreadable,
}

pub(crate) fn read_settings(dir: &Path) -> Settings {
    match std::fs::read_to_string(dir.join(SETTINGS_FILE)) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Settings::Missing,
        Err(_) => Settings::Unreadable,
        Ok(text) => match serde_json::from_str::<OrderedDoc>(&text) {
            Ok(doc) => Settings::Parsed(doc, text),
            Err(_) => Settings::Unreadable,
        },
    }
}

pub(crate) fn read_bridge(dir: &Path) -> Value {
    std::fs::read_to_string(bridge_file(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

pub(crate) fn write_settings(dir: &Path, doc: &OrderedDoc) -> io::Result<()> {
    let text = serde_json::to_string_pretty(doc).map_err(io::Error::other)?;
    write_atomic(&dir.join(SETTINGS_FILE), &format!("{text}\n"))
}

pub(crate) fn unreadable() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "settings.json of this profile is not valid JSON; fix it first",
    )
}

/// The parsed settings to install into, keeping a one-time backup of the untouched file.
pub(crate) fn settings_for_install(dir: &Path) -> io::Result<OrderedDoc> {
    let (doc, original) = match read_settings(dir) {
        Settings::Missing => (OrderedDoc::default(), None),
        Settings::Parsed(doc, text) => (doc, Some(text)),
        Settings::Unreadable => return Err(unreadable()),
    };
    let backup = dir.join(BRIDGE_DIR).join(BACKUP_FILE);
    if let Some(original) = original.filter(|_| !backup.exists()) {
        write_atomic(&backup, &original)?;
    }
    Ok(doc)
}

/// Point `statusLine` at `command`, keeping the earlier line (`kept` keys carried over) in
/// `bridge.json` together with `extra` fields. Running it again refreshes the command only.
pub(crate) fn point_status_line(
    dir: &Path,
    doc: &mut OrderedDoc,
    flag: &str,
    command: &str,
    kept: &[&str],
    mut bridge: Value,
) -> io::Result<()> {
    let current = doc.get("statusLine").cloned();
    let previous = match &current {
        Some(line) if is_ours(line, flag) => read_bridge(dir)
            .get("previousStatusLine")
            .cloned()
            .unwrap_or(Value::Null),
        Some(line) => line.clone(),
        None => Value::Null,
    };
    let mut status_line = json!({ "type": "command", "command": command });
    for key in kept {
        if let Some(value) = current.as_ref().and_then(|line| line.get(*key)) {
            status_line[*key] = value.clone();
        }
    }
    bridge["previousStatusLine"] = previous;
    write_atomic(
        &bridge_file(dir),
        &serde_json::to_string_pretty(&bridge).map_err(io::Error::other)?,
    )?;
    doc.set("statusLine", status_line);
    let _ = std::fs::remove_file(declined_file(dir));
    Ok(())
}

/// Give `statusLine` back to what the profile had before the bridge.
pub(crate) fn restore_status_line(dir: &Path, doc: &mut OrderedDoc, flag: &str) {
    if !doc
        .get("statusLine")
        .is_some_and(|line| is_ours(line, flag))
    {
        return;
    }
    match read_bridge(dir)
        .get("previousStatusLine")
        .filter(|value| !value.is_null())
    {
        Some(previous) => doc.set("statusLine", previous.clone()),
        None => doc.remove("statusLine"),
    }
}

/// The installed status line command, when it is OmniTerm's.
pub(crate) fn our_status_line<'a>(doc: &'a OrderedDoc, flag: &str) -> Option<&'a str> {
    doc.get("statusLine")
        .and_then(command_of)
        .filter(|command| command.contains(flag))
}

/// Delete the bridge's own files and remember that the user took it out.
pub(crate) fn drop_bridge_files(dir: &Path, files: &[PathBuf]) -> io::Result<()> {
    for file in files {
        if let Err(error) = std::fs::remove_file(file) {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error);
            }
        }
    }
    write_atomic(&declined_file(dir), "removed in OmniTerm Settings\n")
}

fn declined_file(dir: &Path) -> PathBuf {
    dir.join(BRIDGE_DIR).join(DECLINED_FILE)
}

/// The user removed this bridge in Settings: only a manual install brings it back.
pub(crate) fn is_declined(dir: &Path) -> bool {
    declined_file(dir).exists()
}
