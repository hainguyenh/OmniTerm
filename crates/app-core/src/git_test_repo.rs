//! Disposable repositories for the git service flow tests.
//!
//! Every fixture lives in its own temporary directory and holds the crate-wide test lock for its
//! whole life: the services resolve `git` through PATH on Linux, and another test swaps PATH while
//! holding that lock. Setup commands strip `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` so a
//! test started from a git hook can never reach the repository that ran the hook.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::MutexGuard;

/// Variables git exports to hooks; inherited by a service call they would redirect it elsewhere.
const REPO_ENV: [&str; 3] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

/// Runs git in `dir` for test setup, panicking with git's stderr on failure.
pub(crate) fn git_in(dir: &Path, args: &[&str]) -> String {
    let output = Command::new(crate::git::resolve_git_binary())
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Repo-local settings that make the fixture independent of the developer's global config.
fn configure(dir: &Path) {
    for (key, value) in [
        ("user.email", "dev@example.test"),
        ("user.name", "Dev"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".no-hooks"),
        ("pull.rebase", "false"),
        ("advice.detachedHead", "false"),
    ] {
        git_in(dir, &["config", key, value]);
    }
}

/// A temporary non-bare repository on `main`, optionally with a bare `origin` beside it.
pub(crate) struct TestRepo {
    pub(crate) root: PathBuf,
    dir: tempfile::TempDir,
    _guard: MutexGuard<'static, ()>,
}

impl TestRepo {
    /// An initialized repository without commits.
    pub(crate) fn empty() -> Self {
        let guard = crate::test_support::lock();
        for name in REPO_ENV {
            if std::env::var_os(name).is_some() {
                // Safe to mutate here: every test that spawns git through this fixture holds the lock.
                std::env::remove_var(name);
            }
        }
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dunce::canonicalize(dir.path())
            .expect("canonical temp dir")
            .join("repo");
        std::fs::create_dir(&root).expect("repo dir");
        git_in(&root, &["init", "-q", "-b", "main"]);
        configure(&root);
        Self {
            root,
            dir,
            _guard: guard,
        }
    }

    /// A repository on `main` whose single commit `initial` adds `a.txt`.
    pub(crate) fn new() -> Self {
        let repo = Self::empty();
        repo.commit_file("a.txt", "one\ntwo\nthree\n", "initial");
        repo
    }

    /// The temporary directory holding the repository, for siblings such as `origin.git`.
    pub(crate) fn base(&self) -> PathBuf {
        dunce::canonicalize(self.dir.path()).expect("canonical temp dir")
    }

    pub(crate) fn git(&self, args: &[&str]) -> String {
        git_in(&self.root, args)
    }

    pub(crate) fn write(&self, rel: &str, content: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::write(path, content).expect("write file");
    }

    pub(crate) fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("read file")
    }

    /// Writes `rel`, stages everything and commits; returns the new commit id.
    pub(crate) fn commit_file(&self, rel: &str, content: &str, message: &str) -> String {
        self.write(rel, content);
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.head()
    }

    pub(crate) fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"])
    }

    /// Adds a bare `origin` next to the repository and pushes `main` to it with tracking.
    pub(crate) fn with_origin(&self) -> PathBuf {
        let origin = self.base().join("origin.git");
        std::fs::create_dir(&origin).expect("origin dir");
        git_in(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let origin_text = origin.to_string_lossy().into_owned();
        self.git(&["remote", "add", "origin", &origin_text]);
        self.git(&["push", "-q", "-u", "origin", "main"]);
        origin
    }

    /// A second clone of `origin` (configured like the fixture), for pushing commits upstream.
    pub(crate) fn clone_origin(&self, origin: &Path) -> PathBuf {
        let clone = self.base().join("other");
        let origin_text = origin.to_string_lossy().into_owned();
        let clone_text = clone.to_string_lossy().into_owned();
        git_in(&self.base(), &["clone", "-q", &origin_text, &clone_text]);
        configure(&clone);
        clone
    }
}

/// Writes, stages and commits `rel` in another checkout such as [`TestRepo::clone_origin`].
pub(crate) fn commit_in(dir: &Path, rel: &str, content: &str, message: &str) {
    std::fs::write(dir.join(rel), content).expect("write file");
    git_in(dir, &["add", "-A"]);
    git_in(dir, &["commit", "-q", "-m", message]);
}
