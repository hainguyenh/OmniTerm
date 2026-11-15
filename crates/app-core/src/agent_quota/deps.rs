//! Everything the providers touch outside their own logic, so each one is testable with fakes.
//!
//! Deliberately absent: any network client and any way to read a credential file. The only inputs
//! are the agents' own CLIs (or the user's profile launchers), Codex's rollout logs, and the
//! profile config Claude Code caches its last reading in.

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::types::AgentKind;

/// A child process environment.
pub type Env = BTreeMap<OsString, OsString>;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CliResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliOptions {
    pub env: Env,
    pub timeout: Duration,
    pub cwd: Option<PathBuf>,
}

/// The platform whose conventions a lookup follows; a parameter so both are testable anywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Unix,
}

impl Platform {
    pub const CURRENT: Platform = if cfg!(windows) {
        Platform::Windows
    } else {
        Platform::Unix
    };

    pub(crate) fn path_separator(self) -> char {
        match self {
            Platform::Windows => ';',
            Platform::Unix => ':',
        }
    }
}

pub trait ProviderDeps: Send + Sync {
    /// Run a CLI hidden, stdin closed, with a hard timeout. Never fails: errors land in the result.
    fn run(&self, command: &Path, args: &[String], options: &CliOptions) -> CliResult;
    /// The last `bytes` of a file as UTF-8 (lossy), or `None` when it cannot be read.
    fn read_tail(&self, file: &Path, bytes: u64) -> Option<String>;
    /// Entry names of a directory. The system implementation reports an unreadable one as empty.
    fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>>;
    /// Modification time in epoch milliseconds; `Ok(None)` when the path does not exist.
    fn mtime(&self, path: &Path) -> io::Result<Option<i64>>;
    fn resolve(&self, agent: AgentKind) -> Option<PathBuf>;
    /// A validated launcher name (e.g. `claude-th`) → its script in the user's bin dir or PATH.
    fn resolve_launcher(&self, name: &str) -> Option<PathBuf>;
    fn home(&self) -> &Path;
    fn tmp(&self) -> &Path;
    fn env(&self) -> &Env;
    fn now(&self) -> i64;
    fn log(&self, message: &str);
}

/// Look a variable up the way the OS does: case-insensitively on Windows.
pub(crate) fn env_var<'a>(env: &'a Env, name: &str) -> Option<&'a OsStr> {
    env.get(OsStr::new(name))
        .map(OsString::as_os_str)
        .or_else(|| {
            env.iter()
                .find(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case(name))
                .map(|(_, value)| value.as_os_str())
        })
}
