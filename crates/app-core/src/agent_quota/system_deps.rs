//! The real `ProviderDeps`: the file system, the process table and the user's environment.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::cli::{resolve_executable, run_cli};
use super::deps::{env_var, CliOptions, CliResult, Env, Platform, ProviderDeps};
use super::types::AgentKind;

pub struct SystemDeps {
    home: PathBuf,
    tmp: PathBuf,
    env: Env,
    log: Box<dyn Fn(&str) + Send + Sync>,
}

/// Known install locations of each agent, tried before PATH.
fn candidates(agent: AgentKind, home: &Path, env: &Env) -> Vec<PathBuf> {
    let local_bin = home.join(".local").join("bin");
    if !cfg!(windows) {
        return match agent {
            AgentKind::Claude => vec![
                local_bin.join("claude"),
                home.join(".claude").join("local").join("claude"),
            ],
            AgentKind::Codex => vec![local_bin.join("codex")],
            AgentKind::Agy => vec![
                local_bin.join("agy"),
                home.join(".gemini")
                    .join("antigravity-cli")
                    .join("bin")
                    .join("agy"),
            ],
        };
    }
    let dir = |name: &str, fallback: &[&str]| {
        env_var(env, name).map_or_else(
            || {
                fallback
                    .iter()
                    .fold(home.to_path_buf(), |path, part| path.join(part))
            },
            PathBuf::from,
        )
    };
    let app_data = dir("APPDATA", &["AppData", "Roaming"]);
    let local_app_data = dir("LOCALAPPDATA", &["AppData", "Local"]);
    match agent {
        AgentKind::Claude => vec![
            local_bin.join("claude.exe"),
            local_app_data
                .join("Programs")
                .join("Claude")
                .join("claude.exe"),
            app_data.join("npm").join("claude.cmd"),
        ],
        AgentKind::Codex => vec![
            local_app_data
                .join("Programs")
                .join("OpenAI")
                .join("Codex")
                .join("bin")
                .join("codex.exe"),
            app_data.join("npm").join("codex.cmd"),
        ],
        AgentKind::Agy => vec![
            local_app_data.join("agy").join("bin").join("agy.exe"),
            local_bin.join("agy.exe"),
            app_data.join("npm").join("agy.cmd"),
        ],
    }
}

/// Launchers live beside the agent in `~/.local/bin` by convention; PATH is searched after.
fn launcher_candidates(name: &str, home: &Path) -> Vec<PathBuf> {
    let bin = home.join(".local").join("bin");
    if cfg!(windows) {
        [".cmd", ".bat", ".exe"]
            .iter()
            .map(|ext| bin.join(format!("{name}{ext}")))
            .collect()
    } else {
        vec![bin.join(name)]
    }
}

impl SystemDeps {
    /// Deps for this user. The wake/probe scratch folder is created here, never chosen by a caller.
    pub fn new(home: PathBuf, log: Box<dyn Fn(&str) + Send + Sync>) -> Self {
        let tmp = std::env::temp_dir().join("omniterm-wake");
        let _ = std::fs::create_dir_all(&tmp);
        Self {
            home,
            tmp,
            env: std::env::vars_os().collect(),
            log,
        }
    }
}

fn read_tail(file: &Path, bytes: u64) -> io::Result<String> {
    let mut handle = File::open(file)?;
    let size = handle.metadata()?.len();
    let length = size.min(bytes);
    handle.seek(SeekFrom::Start(size - length))?;
    let mut buffer = Vec::with_capacity(usize::try_from(length).unwrap_or(0));
    handle.take(length).read_to_end(&mut buffer)?;
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

impl ProviderDeps for SystemDeps {
    fn run(&self, command: &Path, args: &[String], options: &CliOptions) -> CliResult {
        run_cli(command, args, options)
    }

    fn read_tail(&self, file: &Path, bytes: u64) -> Option<String> {
        read_tail(file, bytes).ok()
    }

    fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>> {
        // An unreadable directory is an empty one, as every caller treats it.
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Ok(Vec::new());
        };
        Ok(entries
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect())
    }

    fn mtime(&self, path: &Path) -> io::Result<Option<i64>> {
        let Ok(metadata) = std::fs::metadata(path) else {
            return Ok(None);
        };
        let modified = metadata.modified()?;
        let millis = modified.duration_since(UNIX_EPOCH).map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        });
        Ok(Some(millis))
    }

    fn resolve(&self, agent: AgentKind) -> Option<PathBuf> {
        resolve_executable(
            agent.as_str(),
            &candidates(agent, &self.home, &self.env),
            &self.env,
            Platform::CURRENT,
            &|file| file.is_file(),
        )
    }

    fn resolve_launcher(&self, name: &str) -> Option<PathBuf> {
        resolve_executable(
            name,
            &launcher_candidates(name, &self.home),
            &self.env,
            Platform::CURRENT,
            &|file| file.is_file(),
        )
    }

    fn home(&self) -> &Path {
        &self.home
    }

    fn tmp(&self) -> &Path {
        &self.tmp
    }

    fn env(&self) -> &Env {
        &self.env
    }

    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
            })
    }

    fn log(&self, message: &str) {
        (self.log)(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deps() -> SystemDeps {
        SystemDeps::new(std::env::temp_dir(), Box::new(|_| {}))
    }

    #[test]
    fn reads_tails_directories_and_mtimes_tolerating_missing_paths() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "hello world").expect("write");
        let deps = deps();
        assert_eq!(deps.read_tail(&file, 5).as_deref(), Some("world"));
        assert_eq!(deps.read_tail(&file, 500).as_deref(), Some("hello world"));
        assert!(deps
            .list_dir(dir.path())
            .expect("listing")
            .contains(&"a.txt".to_string()));
        assert!(deps.mtime(&file).expect("mtime").is_some_and(|at| at > 0));
        let missing = dir.path().join("missing");
        assert_eq!(deps.read_tail(&missing, 5), None);
        assert!(deps.list_dir(&missing).expect("empty listing").is_empty());
        assert_eq!(deps.mtime(&missing).expect("no mtime"), None);
        assert!(deps.now() > 0);
        assert!(deps.tmp().is_dir());
    }

    #[test]
    fn resolves_agents_and_launchers_without_failing_when_absent() {
        let deps = deps();
        for agent in AgentKind::ALL {
            let _ = deps.resolve(agent);
        }
        assert_eq!(
            deps.resolve_launcher("claude-agent-quota-test-absent"),
            None
        );
        assert!(!candidates(AgentKind::Agy, deps.home(), deps.env()).is_empty());
        assert!(!launcher_candidates("claude-x", deps.home()).is_empty());
    }

    #[test]
    fn routes_log_lines_to_the_callback_and_runs_through_the_cli_runner() {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&lines);
        let deps = SystemDeps::new(
            std::env::temp_dir(),
            Box::new(move |line| sink.lock().expect("log lock").push(line.to_string())),
        );
        deps.log("probe ran");
        assert_eq!(*lines.lock().expect("log lock"), ["probe ran"]);
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("missing-agent");
        let options = CliOptions {
            env: Env::new(),
            timeout: std::time::Duration::from_secs(5),
            cwd: None,
        };
        let result = deps.run(&missing, &[], &options);
        assert_eq!((result.code, result.timed_out), (None, false));
        assert!(result.stderr.contains("missing-agent"), "{result:?}");
    }

    #[test]
    fn resolves_agents_and_launchers_from_their_install_locations() {
        let home = tempfile::tempdir().expect("temp home");
        let home = home.path();
        let expected = if cfg!(windows) {
            let local = home.join("AppData").join("Local");
            [
                local.join("Programs").join("Claude").join("claude.exe"),
                home.join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("codex.cmd"),
                local.join("agy").join("bin").join("agy.exe"),
            ]
        } else {
            [
                home.join(".claude").join("local").join("claude"),
                home.join(".local").join("bin").join("codex"),
                home.join(".gemini")
                    .join("antigravity-cli")
                    .join("bin")
                    .join("agy"),
            ]
        };
        let launcher = launcher_candidates("claude-work", home)[0].clone();
        for file in expected.iter().chain([&launcher]) {
            let parent = file.parent().expect("a parent folder");
            std::fs::create_dir_all(parent).expect("create the install folder");
            std::fs::write(file, "").expect("write the fake executable");
        }
        let mut deps = SystemDeps::new(home.to_path_buf(), Box::new(|_| {}));
        // Only the install locations count: no PATH, and the Windows folders derive from home.
        deps.env = Env::new();
        let resolved: Vec<Option<PathBuf>> = AgentKind::ALL
            .into_iter()
            .map(|agent| deps.resolve(agent))
            .collect();
        assert_eq!(resolved, expected.map(Some));
        assert_eq!(deps.resolve_launcher("claude-work"), Some(launcher));
        assert_eq!(deps.resolve_launcher("claude-other"), None);
    }

    #[test]
    fn takes_windows_app_data_folders_from_the_environment() {
        let home = Path::new("home");
        let mut env = Env::new();
        env.insert("APPDATA".into(), "roaming".into());
        env.insert("LOCALAPPDATA".into(), "local".into());
        let codex = candidates(AgentKind::Codex, home, &env);
        if cfg!(windows) {
            assert_eq!(
                codex,
                [
                    Path::new("local")
                        .join("Programs")
                        .join("OpenAI")
                        .join("Codex")
                        .join("bin")
                        .join("codex.exe"),
                    Path::new("roaming").join("npm").join("codex.cmd"),
                ]
            );
        } else {
            assert_eq!(codex, [home.join(".local").join("bin").join("codex")]);
        }
    }
}
