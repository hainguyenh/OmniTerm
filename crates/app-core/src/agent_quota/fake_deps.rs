//! In-memory `ProviderDeps` for the provider tests: files by absolute path, directories derived
//! from them, and recorded CLI runs.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::civil::utc_ms;
use super::deps::{CliOptions, CliResult, Env, ProviderDeps};
use super::types::AgentKind;

type RunFn = Box<dyn Fn(usize) -> CliResult + Send + Sync>;
type ListFn = Box<dyn Fn(&Path) -> io::Result<Vec<String>> + Send + Sync>;
type MtimeFn = Box<dyn Fn(&Path) -> io::Result<Option<i64>> + Send + Sync>;

pub(crate) fn home() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"C:\home\me")
    } else {
        PathBuf::from("/home/me")
    }
}

pub(crate) fn now() -> i64 {
    utc_ms(2026, 9, 25, 3, 0)
}

pub(crate) fn ok(stdout: &str) -> CliResult {
    CliResult {
        code: Some(0),
        stdout: stdout.to_string(),
        ..CliResult::default()
    }
}

pub(crate) struct FakeDeps {
    files: BTreeMap<PathBuf, String>,
    pub home: PathBuf,
    pub tmp: PathBuf,
    pub env: Env,
    pub runs: Mutex<Vec<(PathBuf, Vec<String>, CliOptions)>>,
    pub logs: Mutex<Vec<String>>,
    pub launcher_lookups: Mutex<Vec<String>>,
    run_with: RunFn,
    resolve_with: Option<PathBuf>,
    launcher_with: Option<PathBuf>,
    list_with: Option<ListFn>,
    mtime_with: Option<MtimeFn>,
}

impl FakeDeps {
    pub fn new(files: &[(PathBuf, &str)]) -> Self {
        let home = home();
        let mut env = Env::new();
        env.insert("PATH".into(), "".into());
        Self {
            files: files
                .iter()
                .map(|(path, text)| (path.clone(), (*text).to_string()))
                .collect(),
            tmp: home.join("tmp"),
            home,
            env,
            runs: Mutex::new(Vec::new()),
            logs: Mutex::new(Vec::new()),
            launcher_lookups: Mutex::new(Vec::new()),
            run_with: Box::new(|_| ok("")),
            resolve_with: None,
            launcher_with: None,
            list_with: None,
            mtime_with: None,
        }
    }

    pub fn running(mut self, run: impl Fn(usize) -> CliResult + Send + Sync + 'static) -> Self {
        self.run_with = Box::new(run);
        self
    }

    pub fn resolving(mut self, exe: impl Into<PathBuf>) -> Self {
        self.resolve_with = Some(exe.into());
        self
    }

    pub fn with_launcher(mut self, exe: impl Into<PathBuf>) -> Self {
        self.launcher_with = Some(exe.into());
        self
    }

    pub fn with_env(mut self, pairs: &[(&str, &str)]) -> Self {
        self.env = pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect();
        self
    }

    pub fn listing(
        mut self,
        list: impl Fn(&Path) -> io::Result<Vec<String>> + Send + Sync + 'static,
    ) -> Self {
        self.list_with = Some(Box::new(list));
        self
    }

    pub fn with_mtime(
        mut self,
        mtime: impl Fn(&Path) -> io::Result<Option<i64>> + Send + Sync + 'static,
    ) -> Self {
        self.mtime_with = Some(Box::new(mtime));
        self
    }

    pub fn run_count(&self) -> usize {
        self.runs.lock().expect("runs lock").len()
    }

    pub fn run(&self, index: usize) -> (PathBuf, Vec<String>, CliOptions) {
        self.runs.lock().expect("runs lock")[index].clone()
    }

    pub fn logged(&self, needle: &str) -> bool {
        self.logs
            .lock()
            .expect("logs lock")
            .iter()
            .any(|line| line.contains(needle))
    }
}

impl ProviderDeps for FakeDeps {
    fn run(&self, command: &Path, args: &[String], options: &CliOptions) -> CliResult {
        let index = {
            let mut runs = self.runs.lock().expect("runs lock");
            runs.push((command.to_path_buf(), args.to_vec(), options.clone()));
            runs.len() - 1
        };
        (self.run_with)(index)
    }

    fn read_tail(&self, file: &Path, bytes: u64) -> Option<String> {
        let text = self.files.get(file)?;
        let keep = usize::try_from(bytes).unwrap_or(usize::MAX).min(text.len());
        Some(text[text.len() - keep..].to_string())
    }

    fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>> {
        if let Some(list) = &self.list_with {
            return list(dir);
        }
        let mut names: Vec<String> = self
            .files
            .keys()
            .filter_map(|file| file.strip_prefix(dir).ok())
            .filter_map(|rest| rest.components().next())
            .map(|first| first.as_os_str().to_string_lossy().into_owned())
            .collect();
        names.dedup();
        Ok(names)
    }

    fn mtime(&self, path: &Path) -> io::Result<Option<i64>> {
        if let Some(mtime) = &self.mtime_with {
            return mtime(path);
        }
        Ok(self.files.contains_key(path).then(now))
    }

    fn resolve(&self, _agent: AgentKind) -> Option<PathBuf> {
        self.resolve_with.clone()
    }

    fn resolve_launcher(&self, name: &str) -> Option<PathBuf> {
        self.launcher_lookups
            .lock()
            .expect("lookups lock")
            .push(name.to_string());
        self.launcher_with.clone()
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
        now()
    }

    fn log(&self, message: &str) {
        self.logs
            .lock()
            .expect("logs lock")
            .push(message.to_string());
    }
}
