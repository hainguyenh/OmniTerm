//! Running agent CLIs and resolving them, for the quota probes and wake-ups.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::deps::{env_var, CliOptions, CliResult, Env, Platform};

const OUTPUT_CAP: usize = 256 * 1024;
const POLL: Duration = Duration::from_millis(25);
/// How long output may keep draining after the process itself has gone.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Arguments for a `.cmd` shim go through cmd.exe. They are validated upstream (fixed flags, or a
/// prompt restricted to letters, digits and punctuation cmd does not interpret); this still refuses
/// the metacharacters rather than trusting every caller.
pub(crate) fn check_cmd_arg(arg: &str) -> Result<(), String> {
    if arg.chars().any(|c| {
        matches!(
            c,
            '"' | '%' | '^' | '&' | '|' | '<' | '>' | '!' | '\r' | '\n'
        )
    }) {
        return Err("Refusing to pass shell metacharacters to cmd.exe".to_string());
    }
    Ok(())
}

fn is_shim(command: &Path) -> bool {
    command
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
}

fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn drain(mut source: impl Read + Send + 'static) -> mpsc::Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut chunk = [0u8; 8192];
        while let Ok(read) = source.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if kept.len() < OUTPUT_CAP {
                kept.extend_from_slice(&chunk[..read]);
            }
        }
        let _ = sender.send(String::from_utf8_lossy(&kept).into_owned());
    });
    receiver
}

fn failure(message: String) -> CliResult {
    CliResult {
        code: None,
        stdout: String::new(),
        stderr: message,
        timed_out: false,
    }
}

/// Run a CLI hidden, with stdin closed (Claude Code waits ~3 s for stdin otherwise) and a hard
/// timeout after which the whole process tree is killed.
pub fn run_cli(command: &Path, args: &[String], options: &CliOptions) -> CliResult {
    if cfg!(windows) && is_shim(command) {
        if let Some(error) = args.iter().find_map(|arg| check_cmd_arg(arg).err()) {
            return failure(error);
        }
    }
    let mut builder = Command::new(command);
    builder
        .args(args)
        .env_clear()
        .envs(&options.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &options.cwd {
        builder.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        builder.creation_flags(0x0800_0000);
    }
    let mut child = match builder.spawn() {
        Ok(child) => child,
        Err(error) => return failure(format!("{}: {error}", command.display())),
    };
    let stdout = child.stdout.take().map(drain);
    let stderr = child.stderr.take().map(drain);
    let deadline = Instant::now() + options.timeout;
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                kill_tree(&mut child);
                break None;
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(_) => {
                kill_tree(&mut child);
                break None;
            }
        }
    };
    let collect = |receiver: Option<mpsc::Receiver<String>>| {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .max(DRAIN_GRACE);
        receiver
            .and_then(|receiver| receiver.recv_timeout(wait).ok())
            .unwrap_or_default()
    };
    CliResult {
        code,
        stdout: collect(stdout),
        stderr: collect(stderr),
        timed_out,
    }
}

/// First existing candidate, then a PATH search honouring PATHEXT on Windows.
pub fn resolve_executable(
    name: &str,
    candidates: &[PathBuf],
    env: &Env,
    platform: Platform,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if let Some(direct) = candidates
        .iter()
        .find(|candidate| !candidate.as_os_str().is_empty() && exists(candidate))
    {
        return Some(direct.clone());
    }
    let extensions: Vec<String> = match platform {
        Platform::Windows => env_var(env, "PATHEXT")
            .map_or_else(
                || ".EXE;.CMD;.BAT".to_string(),
                |value| value.to_string_lossy().into_owned(),
            )
            .split(';')
            .map(str::to_ascii_lowercase)
            .filter(|ext| [".exe", ".cmd", ".bat"].contains(&ext.as_str()))
            .collect(),
        Platform::Unix => vec![String::new()],
    };
    let path = env_var(env, "PATH")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.split(platform.path_separator())
        .filter(|dir| !dir.is_empty())
        .find_map(|dir| {
            extensions
                .iter()
                .map(|ext| Path::new(dir).join(format!("{name}{ext}")))
                .find(|file| exists(file))
        })
}

fn normalize_dir(dir: &Path) -> String {
    let absolute = if dir.is_absolute() {
        dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(dir))
            .unwrap_or_else(|_| dir.to_path_buf())
    };
    absolute
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

/// Environment for a probe against one profile. The agent's default directory is expressed by
/// *unsetting* the variable: `CLAUDE_CONFIG_DIR=~/.claude` is not the same as no variable, because
/// the default profile keeps its account file at `~/.claude.json`, outside the directory.
pub fn profile_env(
    variable: &str,
    profile_dir: Option<&Path>,
    default_dir: &Path,
    base: &Env,
) -> Env {
    let mut env: Env = base
        .iter()
        .filter(|(key, _)| !key.to_string_lossy().eq_ignore_ascii_case(variable))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if let Some(dir) = profile_dir.filter(|dir| !dir.as_os_str().is_empty()) {
        if normalize_dir(dir) != normalize_dir(default_dir) {
            env.insert(OsString::from(variable), dir.as_os_str().to_os_string());
        }
    }
    env
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
