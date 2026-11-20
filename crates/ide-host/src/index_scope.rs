//! Which projects of an OmniTerm container workspace the index covers.
//!
//! A container lists every folder of a multi-project workspace, but indexing them all at start-up
//! competes with the user's terminals for CPU and disk. OmniTerm indexes only the projects the user
//! chose to index this session (none at start-up) and records that scope next to the container's
//! workspace file on every project sync. A container without a record (one OmniTerm did not
//! write) indexes every project, as before.

use ide_core::{IdeError, IdeResult};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Whether a project may be indexed yet. OmniTerm indexes nothing on its own: a project's index
/// waits (held, see `ide_index::IndexOptions::held`) until the user chooses to index it. A root
/// without a gate is indexed as usual (projects the IDE windows open themselves).
#[derive(Default)]
pub struct IndexGates {
    allowed: RwLock<HashMap<PathBuf, bool>>,
}

impl IndexGates {
    /// Records whether the project at `root` may be indexed.
    pub fn set(&self, root: &Path, allowed: bool) {
        self.allowed.write().insert(comparable(root), allowed);
    }

    /// Whether the project at `root` may be indexed (true without a gate).
    pub fn allows(&self, root: &Path) -> bool {
        self.allowed.read().get(&comparable(root)).copied().unwrap_or(true)
    }
}

const FILE: &str = ".omniterm/index-scope.json";

#[derive(Serialize, Deserialize)]
struct Scope {
    folders: Vec<PathBuf>,
}

fn comparable(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_owned())
}

/// The folders container `root` indexes, as recorded; `None` when nothing is recorded.
pub fn load(root: &Path) -> Option<Vec<PathBuf>> {
    let bytes = std::fs::read(root.join(FILE)).ok()?;
    match serde_json::from_slice::<Scope>(&bytes) {
        Ok(scope) => Some(scope.folders),
        Err(e) => {
            tracing::warn!("ignoring a damaged index scope in {}: {e}", root.display());
            None
        }
    }
}

/// Records that container `root` indexes exactly `folders`. An unchanged record is not written
/// again: every project re-sync saves the scope, and each write would wake the file watchers.
pub fn save(root: &Path, folders: &[PathBuf]) -> IdeResult<()> {
    let scope = Scope { folders: folders.iter().map(|f| comparable(f)).collect() };
    if load(root).is_some_and(|recorded| recorded == scope.folders) {
        return Ok(());
    }
    let bytes = serde_json::to_vec_pretty(&scope).map_err(|e| IdeError::internal(e.to_string()))?;
    let file = root.join(FILE);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    ide_vfs::write_atomic(&file, &bytes)?;
    Ok(())
}

/// `folders` limited to the recorded scope of container `root` (all of them without a record).
pub(crate) fn retain_indexed(root: &Path, folders: Vec<PathBuf>) -> Vec<PathBuf> {
    let Some(scope) = load(root) else { return folders };
    let scope: Vec<PathBuf> = scope.iter().map(|f| comparable(f)).collect();
    folders.into_iter().filter(|f| scope.contains(&comparable(f))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_a_record_every_folder_is_indexed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let folders = vec![dir.path().join("a"), dir.path().join("b")];
        assert_eq!(retain_indexed(dir.path(), folders.clone()), folders);
    }

    #[test]
    fn a_record_limits_the_indexed_folders() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (a, b, c) = (dir.path().join("a"), dir.path().join("b"), dir.path().join("c"));
        for f in [&a, &b, &c] {
            std::fs::create_dir_all(f).expect("project folder");
        }
        let container = dir.path().join("container");
        save(&container, std::slice::from_ref(&b)).expect("save scope");
        assert_eq!(retain_indexed(&container, vec![a.clone(), b.clone(), c.clone()]), vec![b.clone()]);

        save(&container, &[]).expect("save empty scope");
        assert!(retain_indexed(&container, vec![a, b, c]).is_empty(), "an empty record indexes nothing");
    }

    #[test]
    fn a_gate_holds_only_the_projects_it_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        let gates = IndexGates::default();
        assert!(gates.allows(&a), "a project without a gate is indexed");
        gates.set(&a, false);
        assert!(!gates.allows(&a));
        assert!(gates.allows(&b));
        gates.set(&a, true);
        assert!(gates.allows(&a));
    }

    #[test]
    fn an_unchanged_scope_is_not_written_again() {
        let dir = tempfile::tempdir().expect("temp dir");
        let a = dir.path().join("a");
        std::fs::create_dir_all(&a).expect("project folder");
        let container = dir.path().join("container");
        save(&container, std::slice::from_ref(&a)).expect("save scope");
        let file = container.join(FILE);
        // Marks the record so a rewrite would be visible.
        let marked = std::fs::read_to_string(&file).expect("read scope").replace('\n', " \n");
        std::fs::write(&file, &marked).expect("mark scope");

        save(&container, std::slice::from_ref(&a)).expect("save same scope");
        assert_eq!(std::fs::read_to_string(&file).expect("read scope"), marked, "same scope rewrote the file");

        save(&container, &[]).expect("save new scope");
        assert!(retain_indexed(&container, vec![a]).is_empty(), "a changed scope is written");
    }

    #[test]
    fn a_damaged_record_indexes_every_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join(".omniterm")).expect("metadata dir");
        std::fs::write(dir.path().join(FILE), b"{not json").expect("write");
        let folders = vec![dir.path().join("a")];
        assert_eq!(retain_indexed(dir.path(), folders.clone()), folders);
    }
}
