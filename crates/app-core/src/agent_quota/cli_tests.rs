use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;

fn options(timeout_ms: u64, cwd: Option<PathBuf>) -> CliOptions {
    CliOptions {
        env: std::env::vars_os().collect(),
        timeout: Duration::from_millis(timeout_ms),
        cwd,
    }
}

/// A script that prints to both streams and exits with code 3, run the platform's way.
fn script(dir: &Path, name: &str, windows_body: &str, unix_body: &str) -> (PathBuf, Vec<String>) {
    if cfg!(windows) {
        let file = dir.join(format!("{name}.cmd"));
        std::fs::write(&file, windows_body).expect("write the test script");
        (file, Vec::new())
    } else {
        (
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), unix_body.to_string()],
        )
    }
}

#[test]
fn captures_output_and_the_exit_code_with_stdin_closed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (command, args) = script(
        dir.path(),
        "streams",
        "@echo out\r\n@echo err 1>&2\r\n@exit /b 3\r\n",
        "cat >/dev/null; echo out; echo err >&2; exit 3",
    );
    let result = run_cli(
        &command,
        &args,
        &options(20_000, Some(dir.path().to_path_buf())),
    );
    assert_eq!(
        (result.code, result.timed_out),
        (Some(3), false),
        "{result:?}"
    );
    assert_eq!(result.stdout.trim(), "out");
    assert_eq!(result.stderr.trim(), "err");
}

#[test]
fn kills_a_process_that_outlives_its_timeout() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (command, args) = script(
        dir.path(),
        "slow",
        "@ping -n 30 127.0.0.1 >nul\r\n",
        "sleep 30",
    );
    let started = std::time::Instant::now();
    let result = run_cli(&command, &args, &options(300, None));
    assert!(result.timed_out, "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(15));
}

#[test]
fn reports_a_missing_executable_instead_of_failing() {
    let missing = std::env::temp_dir().join("no-such-agent-binary-omniterm");
    let result = run_cli(&missing, &[], &options(1_000, None));
    assert_eq!(result.code, None);
    assert!(!result.stderr.is_empty());
}

#[cfg(windows)]
#[test]
fn runs_a_cmd_shim_with_quoted_arguments_and_refuses_metacharacters() {
    let dir = tempfile::Builder::new()
        .prefix("agent quota ")
        .tempdir()
        .expect("temp dir");
    let shim = dir.path().join("echo args.cmd");
    std::fs::write(&shim, "@echo %~1^|%~2\r\n").expect("write the shim");
    let result = run_cli(
        &shim,
        &["-p".to_string(), "hello there".to_string()],
        &options(20_000, None),
    );
    assert_eq!(result.stdout.trim(), "-p|hello there", "{result:?}");
    let refused = run_cli(
        Path::new("x.cmd"),
        &["a&b".to_string()],
        &options(1_000, None),
    );
    assert_eq!(refused.code, None);
    assert!(refused.stderr.contains("metacharacters"));
}

#[test]
fn refuses_cmd_metacharacters_only() {
    for ok in ["-p", "a b", ""] {
        assert!(check_cmd_arg(ok).is_ok(), "{ok}");
    }
    for bad in [
        "a\"b", "%x%", "a^b", "a&b", "a|b", "a<b", "a>b", "a!b", "a\nb",
    ] {
        assert!(check_cmd_arg(bad).is_err(), "{bad}");
    }
}

#[test]
fn resolves_a_known_install_location_then_path() {
    let known = |files: Vec<PathBuf>| move |file: &Path| files.iter().any(|known| known == file);
    let empty = Env::new();
    let found = resolve_executable(
        "claude",
        &[PathBuf::from("/a/claude"), PathBuf::from("/b/claude")],
        &empty,
        Platform::Unix,
        &known(vec![PathBuf::from("/b/claude")]),
    );
    assert_eq!(found, Some(PathBuf::from("/b/claude")));

    let dir = Path::new("opt").join("bin");
    let mut windows = Env::new();
    windows.insert("Path".into(), dir.clone().into_os_string());
    windows.insert("PATHEXT".into(), ".COM;.EXE;.CMD".into());
    let shim = dir.join("codex.cmd");
    assert_eq!(
        resolve_executable(
            "codex",
            &[PathBuf::new()],
            &windows,
            Platform::Windows,
            &known(vec![shim.clone()])
        ),
        Some(shim)
    );

    let mut unix = Env::new();
    unix.insert("PATH".into(), dir.clone().into_os_string());
    let binary = dir.join("codex");
    assert_eq!(
        resolve_executable(
            "codex",
            &[],
            &unix,
            Platform::Unix,
            &known(vec![binary.clone()])
        ),
        Some(binary)
    );
    assert_eq!(
        resolve_executable("codex", &[], &empty, Platform::Unix, &known(Vec::new())),
        None
    );
}

#[test]
fn sets_a_custom_profile_and_unsets_the_default_one_whatever_the_casing() {
    let mut base = Env::new();
    base.insert("claude_config_dir".into(), "stale".into());
    base.insert("PATH".into(), "p".into());
    let custom = profile_env(
        "CLAUDE_CONFIG_DIR",
        Some(Path::new("/p/work")),
        Path::new("/home/.claude"),
        &base,
    );
    let mut expected = Env::new();
    expected.insert("PATH".into(), "p".into());
    expected.insert("CLAUDE_CONFIG_DIR".into(), "/p/work".into());
    assert_eq!(custom, expected);
    let default = profile_env(
        "CLAUDE_CONFIG_DIR",
        Some(Path::new("/home/.claude/")),
        Path::new("/home/.claude"),
        &base,
    );
    assert_eq!(default.keys().collect::<Vec<_>>(), ["PATH"]);
    assert!(profile_env("CODEX_HOME", None, Path::new("/home/.codex"), &Env::new()).is_empty());
}

#[test]
fn treats_only_cmd_and_bat_files_as_shims() {
    for shim in ["x.cmd", "x.CMD", "dir/x.bat", "x.Bat"] {
        assert!(is_shim(Path::new(shim)), "{shim}");
    }
    for plain in ["x.exe", "x", "x.cmd.txt", ".cmd"] {
        assert!(!is_shim(Path::new(plain)), "{plain}");
    }
}

/// Yields `chunks` full buffers of `a`, then fails like a broken pipe.
struct Failing {
    chunks: usize,
}

impl Read for Failing {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.chunks == 0 {
            return Err(std::io::Error::other("broken pipe"));
        }
        self.chunks -= 1;
        buffer.fill(b'a');
        Ok(buffer.len())
    }
}

#[test]
fn drains_output_up_to_the_cap_and_keeps_what_arrived_before_an_error() {
    let large = drain(std::io::Cursor::new(vec![b'x'; OUTPUT_CAP + 50_000]))
        .recv_timeout(Duration::from_secs(10))
        .expect("drained output");
    assert_eq!(large.len(), OUTPUT_CAP);
    assert!(large.bytes().all(|b| b == b'x'));
    let partial = drain(Failing { chunks: 2 })
        .recv_timeout(Duration::from_secs(10))
        .expect("drained output");
    assert_eq!(partial, "a".repeat(2 * 8192));
}

#[test]
fn falls_back_to_the_default_windows_extensions_without_pathext() {
    let dir = Path::new("tools");
    let mut env = Env::new();
    env.insert("PATH".into(), "tools;;".into());
    let shim = dir.join("agy.bat");
    let ps1 = dir.join("agy.ps1");
    let exists = |file: &Path| file == shim || file == ps1;
    assert_eq!(
        resolve_executable("agy", &[], &env, Platform::Windows, &exists),
        Some(dir.join("agy.bat"))
    );
    // A PATHEXT naming only extensions that are never run is honoured, so nothing is found.
    env.insert("PATHEXT".into(), ".PS1;.COM".into());
    assert_eq!(
        resolve_executable("agy", &[], &env, Platform::Windows, &exists),
        None
    );
}
