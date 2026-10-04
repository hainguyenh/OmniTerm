//! Disposable Git repositories for the git command tests.
//!
//! Each repository lives in its own temp dir with repo-local identity, signing, hook and line-ending
//! settings, so the tests neither depend on the developer's global Git config nor reach the OmniTerm
//! checkout. Callers hold `test_support::lock()` while any of this runs: other tests in the binary
//! replace `PATH`, and [`ScrubbedGitEnv`] edits process-wide env vars.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

/// Env vars that point `git` at a repository other than its working directory's.
const REDIRECTING_VARS: [&str; 3] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

/// Removes the redirecting env vars for its lifetime and restores them on drop.
///
/// A Git hook running the test suite exports `GIT_DIR`; the commands under test inherit the process
/// env, so without this a mutating command could land in the repository that launched the hook.
pub(crate) struct ScrubbedGitEnv(Vec<(&'static str, OsString)>);

impl ScrubbedGitEnv {
    pub(crate) fn new() -> Self {
        let saved: Vec<_> = REDIRECTING_VARS
            .iter()
            .filter_map(|key| std::env::var_os(key).map(|value| (*key, value)))
            .collect();
        for (key, _) in &saved {
            std::env::remove_var(key);
        }
        Self(saved)
    }
}

impl Drop for ScrubbedGitEnv {
    fn drop(&mut self) {
        for (key, value) in &self.0 {
            std::env::set_var(key, value);
        }
    }
}

/// Runs `git` in `dir`, asserts it succeeded, and returns its stdout.
pub(crate) fn git(dir: &Path, args: &[&str]) -> String {
    let mut command = Command::new(app_core::git::resolve_git_binary());
    command
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0");
    for key in REDIRECTING_VARS {
        command.env_remove(key);
    }
    let output = command.output().expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Pins the settings a test must not inherit from the machine's global config.
pub(crate) fn configure(dir: &Path) {
    let settings = [
        ("user.name", "OmniTerm Tests"),
        ("user.email", "tests@omniterm.invalid"),
        ("commit.gpgsign", "false"),
        ("tag.gpgsign", "false"),
        ("core.autocrlf", "false"),
        // A missing directory disables every hook, including a global `core.hooksPath`.
        ("core.hooksPath", ".git/no-hooks"),
    ];
    for (key, value) in settings {
        git(dir, &["config", key, value]);
    }
}

/// Initializes a non-bare repository on `main` at `dir`, creating the directory first.
pub(crate) fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).expect("create repository directory");
    git(dir, &["init", "-q", "-b", "main"]);
    configure(dir);
}

/// Writes `content` to `relative` under `dir`, creating parent directories.
pub(crate) fn write(dir: &Path, relative: &str, content: &str) {
    let path = dir.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent directory");
    }
    fs::write(path, content).expect("write file");
}

/// Reads `relative` under `dir` as text.
pub(crate) fn read(dir: &Path, relative: &str) -> String {
    fs::read_to_string(dir.join(relative)).expect("read file")
}

/// Writes, stages and commits one file, returning the new commit's full hash.
pub(crate) fn commit_file(dir: &Path, relative: &str, content: &str, message: &str) -> String {
    write(dir, relative, content);
    git(dir, &["add", "--", relative]);
    git(dir, &["commit", "-q", "-m", message]);
    head(dir)
}

/// The full hash `HEAD` points at.
pub(crate) fn head(dir: &Path) -> String {
    git(dir, &["rev-parse", "HEAD"]).trim().to_string()
}

/// A temp dir holding a repository at `<temp>/repo` with one commit of `README.md`.
///
/// The path is canonical because `find_repo_root` canonicalizes, and a Windows temp dir can be
/// spelled with an 8.3 short name that would otherwise compare unequal.
pub(crate) fn repo_with_commit() -> (TempDir, PathBuf) {
    let temp = TempDir::new().expect("temp dir");
    let root = dunce::canonicalize(temp.path())
        .expect("canonical temp dir")
        .join("repo");
    init_repo(&root);
    commit_file(&root, "README.md", "hello\n", "initial commit");
    (temp, root)
}

/// The string form of `path` the commands take as `cwd`.
pub(crate) fn cwd(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
