//! Package-aligned sources for fwcd's path-based class resolver. Never write into a project.
use ide_core::{IdeError, IdeResult};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

pub const ADAPTER: &str = "kotlin-debug-adapter";

pub struct SourceShadow {
    dir: tempfile::TempDir,
    paths: HashMap<PathBuf, PathBuf>,
    copies: Vec<(PathBuf, PathBuf)>,
    source_dir: PathBuf,
    roots: HashMap<PathBuf, usize>,
}

impl SourceShadow {
    pub fn create(project: &Path) -> IdeResult<Self> {
        let base = fs::canonicalize(std::env::temp_dir())?;
        // Check before creating anything, including when TMPDIR points into a project.
        if base.starts_with(fs::canonicalize(project)?) {
            return Err(IdeError::invalid("Kotlin source shadow must be outside the project"));
        }
        let dir = tempfile::Builder::new().prefix("omniterm-kotlin-").tempdir_in(base)?;
        let source_dir = if project.join("src").is_dir() { project.join("src") } else { project.to_owned() };
        let mut shadow = Self {
            dir,
            paths: HashMap::new(),
            copies: Vec::new(),
            source_dir: source_dir.clone(),
            roots: HashMap::new(),
        };
        shadow.scan(&source_dir)?;
        Ok(shadow)
    }

    pub fn root(&self) -> &Path {
        self.dir.path()
    }

    fn scan(&mut self, dir: &Path) -> IdeResult<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let kind = entry.file_type()?;
            if kind.is_dir() {
                if !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | ".gradle" | "build" | "target" | "node_modules" | ".idea" | ".omniterm")
                ) {
                    self.scan(&path)?;
                }
            } else if matches!(path.extension().and_then(|s| s.to_str()), Some("kt" | "java")) {
                self.add(&path)?;
            }
        }
        Ok(())
    }

    fn add(&mut self, real: &Path) -> IdeResult<()> {
        if self.paths.contains_key(real) {
            return Ok(());
        }
        let Ok(text) = fs::read_to_string(real) else {
            tracing::debug!("Kotlin debug shadow: skipping unreadable {}", real.display());
            return Ok(());
        };
        let language = if real.extension().is_some_and(|e| e == "java") { "java" } else { "kotlin" };
        let relative = real.strip_prefix(&self.source_dir).unwrap_or(real);
        let mut components = relative.components();
        let source_set = components.next().map(|c| PathBuf::from(c.as_os_str())).unwrap_or_default();
        let next_root = self.roots.len();
        let index = *self.roots.entry(source_set).or_insert(next_root);
        let mut shadow = self.root().join(format!("root{index}")).join("src/main").join(language);
        for part in package(&text).split('.').filter(|s| !s.is_empty()) {
            if part == ".." || part.contains(['/', '\\']) {
                tracing::debug!("Kotlin debug shadow: skipping {} (invalid package)", real.display());
                return Ok(());
            }
            shadow.push(part);
        }
        shadow.push(real.file_name().ok_or_else(|| IdeError::invalid("Source has no filename"))?);
        // Same package and file name in one source set (e.g. main and test of a module):
        // the first wins; breakpoints in the other stay unverified instead of failing the session.
        if self.paths.values().any(|p| p == &shadow) {
            tracing::debug!("Kotlin debug shadow: skipping ambiguous {}", real.display());
            return Ok(());
        }
        fs::create_dir_all(shadow.parent().unwrap())?;
        if link(real, &shadow).is_err() {
            fs::copy(real, &shadow)?;
            self.copies.push((real.to_owned(), shadow.clone()));
        }
        self.paths.insert(real.to_owned(), shadow);
        Ok(())
    }

    pub fn adapter_path(&self, real: &Path) -> Option<PathBuf> {
        self.paths.get(real).cloned()
    }
    pub fn client_path(&self, shadow: &Path) -> Option<PathBuf> {
        self.paths.iter().find_map(|(real, p)| (p == shadow).then(|| real.clone()))
    }
    pub fn refresh(&mut self) -> IdeResult<()> {
        for (real, shadow) in &self.copies {
            if real.is_file() {
                fs::copy(real, shadow)?;
            }
        }
        self.scan(&self.source_dir.clone())
    }
    pub fn translate(&self, value: &mut Value) {
        match value {
            Value::Object(obj) => {
                if let Some(path) = obj.get("path").and_then(Value::as_str).and_then(|p| self.client_path(Path::new(p)))
                {
                    obj.insert("path".into(), Value::String(path.to_string_lossy().into_owned()));
                }
                for child in obj.values_mut() {
                    self.translate(child);
                }
            }
            Value::Array(items) => {
                for child in items {
                    self.translate(child);
                }
            }
            _ => {}
        }
    }
}

#[cfg(unix)]
fn link(real: &Path, shadow: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(real, shadow)
}
#[cfg(windows)]
fn link(real: &Path, shadow: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(real, shadow)
}

// Remove comments before reading the package directive (including nested Kotlin block comments).
fn package(text: &str) -> String {
    let mut clean = String::new();
    let mut chars = text.chars().peekable();
    let mut depth = 0;
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            depth += 1;
            clean.push(' ');
        } else if depth > 0 && c == '*' && chars.peek() == Some(&'/') {
            chars.next();
            depth -= 1;
        } else if depth == 0 && c == '/' && chars.peek() == Some(&'/') {
            for c in chars.by_ref() {
                if c == '\n' {
                    clean.push('\n');
                    break;
                }
            }
        } else if depth == 0 {
            clean.push(c);
        }
    }
    clean
        .lines()
        .find_map(|line| {
            let rest = line.trim().strip_prefix("package")?;
            if !rest.starts_with(char::is_whitespace) {
                return None;
            }
            Some(rest.split(';').next().unwrap_or_default().trim().replace('`', ""))
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_shadow_round_trip_and_cleanup() {
        let project = tempfile::tempdir().unwrap();
        let real = project.path().join("Main.kt");
        fs::write(&real, "/* package wrong */\npackage org.example\nfun main() {}\n").unwrap();
        let shadow = SourceShadow::create(project.path()).unwrap();
        let path = shadow.adapter_path(&real).unwrap();
        assert!(!path.starts_with(project.path()));
        assert!(path.ends_with("src/main/kotlin/org/example/Main.kt"));
        assert_eq!(fs::read_to_string(&path).unwrap(), fs::read_to_string(&real).unwrap());
        let mut payload =
            serde_json::json!({"stackFrames": [{"source": {"path": path}, "line": 6}], "source": {"path": path}});
        shadow.translate(&mut payload);
        assert_eq!(payload["stackFrames"][0]["source"]["path"], real.to_string_lossy().as_ref());
        assert_eq!(payload["source"]["path"], real.to_string_lossy().as_ref());
        let root = shadow.root().to_owned();
        drop(shadow);
        assert!(!root.exists());
        assert!(real.exists());
    }
    #[test]
    fn copies_refresh_after_save() {
        let project = tempfile::tempdir().unwrap();
        let real = project.path().join("Main.java");
        fs::write(&real, "package example;\nclass Main {}\n").unwrap();
        let mut shadow = SourceShadow::create(project.path()).unwrap();
        let path = shadow.adapter_path(&real).unwrap();
        fs::remove_file(&path).unwrap();
        fs::copy(&real, &path).unwrap();
        shadow.copies.push((real.clone(), path.clone()));
        fs::write(&real, "package example;\nclass Main { int i; }\n").unwrap();
        shadow.refresh().unwrap();
        assert_eq!(fs::read(&path).unwrap(), fs::read(&real).unwrap());
    }
}
