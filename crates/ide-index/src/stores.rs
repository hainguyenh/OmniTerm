//! Which store persists each file's record. The project's own store holds the files of the project
//! folder and the Recent Files list. With [`crate::IndexOptions::folder_stores`], every content
//! root outside the project folder has a store of its own, named after the folder by
//! [`crate::folder_key`]: a folder indexed as a workspace member, in any workspace, or opened alone
//! reuses the records another of them wrote.

use crate::data::FileRecord;
use crate::filter::{ABSOLUTE_KEY, PathFilter};
use crate::store::Store;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Persisted records, by file.
pub(crate) type Records = Vec<(PathBuf, FileRecord)>;

pub(crate) struct Stores {
    home: Option<Arc<Store>>,
    /// Where the content roots' stores live; `None` keeps their records in `home`.
    folders_dir: Option<PathBuf>,
    fingerprint: String,
    folders: Mutex<Folders>,
}

#[derive(Default)]
struct Folders {
    /// Each content root's store once used; `None` when it can't be (its files stay in memory).
    open: HashMap<PathBuf, Option<Arc<Store>>>,
    /// Content roots whose records were read into memory since they entered the scope.
    loaded: HashSet<PathBuf>,
}

struct Batch {
    store: Arc<Store>,
    puts: Vec<(String, FileRecord)>,
    deletes: Vec<String>,
}

fn batch(batches: &mut Vec<Batch>, store: Arc<Store>) -> &mut Batch {
    let i = match batches.iter().position(|b| Arc::ptr_eq(&b.store, &store)) {
        Some(i) => i,
        None => {
            batches.push(Batch { store, puts: Vec::new(), deletes: Vec::new() });
            batches.len() - 1
        }
    };
    &mut batches[i]
}

impl Stores {
    pub(crate) fn new(home: Option<Arc<Store>>, folders_dir: Option<PathBuf>, fingerprint: String) -> Self {
        Self { home, folders_dir, fingerprint, folders: Mutex::default() }
    }

    /// Nothing is persisted ([`crate::ProjectIndex::unindexed`]).
    pub(crate) fn none() -> Self {
        Self::new(None, None, String::new())
    }

    /// The project's own store: the project folder's files and the Recent Files list.
    pub(crate) fn home(&self) -> Option<&Store> {
        self.home.as_deref()
    }

    fn folder(&self, folders: &mut Folders, folder: &Path) -> Option<Arc<Store>> {
        let dir = self.folders_dir.as_ref()?;
        folders
            .open
            .entry(folder.to_owned())
            .or_insert_with(|| Store::open(&dir.join(crate::folder_key(folder)), folder, &self.fingerprint))
            .clone()
    }

    /// The store persisting `path`, and its key there. A content root whose store can't be used
    /// never falls back to the project's store, which would then hold records nobody else reads.
    fn route(&self, folders: &mut Folders, filter: &PathFilter, path: &Path) -> Option<(Arc<Store>, String)> {
        if self.folders_dir.is_some()
            && let Some((folder, key)) = filter.folder_key(path)
        {
            return Some((self.folder(folders, folder)?, key));
        }
        Some((self.home.clone()?, filter.store_key(path)?))
    }

    /// Writes upserts and deletions, each to its file's store; files without one are skipped. A
    /// durable write also makes every store's earlier non-durable writes durable.
    pub(crate) fn apply(&self, filter: &PathFilter, puts: Records, deletes: &[PathBuf], durable: bool) {
        let mut batches = Vec::new();
        {
            let mut folders = self.folders.lock();
            for (path, record) in puts {
                if let Some((store, key)) = self.route(&mut folders, filter, &path) {
                    batch(&mut batches, store).puts.push((key, record));
                }
            }
            for path in deletes {
                if let Some((store, key)) = self.route(&mut folders, filter, path) {
                    batch(&mut batches, store).deletes.push(key);
                }
            }
            if durable {
                for store in self.home.iter().chain(folders.open.values().flatten()) {
                    batch(&mut batches, store.clone());
                }
            }
        }
        for b in batches {
            if let Err(e) = b.store.apply(&b.puts, &b.deletes, durable) {
                tracing::warn!("index cache write failed: {e}");
            }
        }
    }

    /// The project store's records. With folder stores, the content roots' records an earlier
    /// version kept there (by absolute path) leave it and come back apart (`moved`), for the
    /// caller to write to their folders' stores.
    pub(crate) fn load_home(&self, filter: &PathFilter) -> (Records, Records) {
        let Some(home) = &self.home else { return Default::default() };
        let records = match home.load() {
            Ok(records) => records,
            Err(e) => {
                tracing::warn!("index cache load failed: {e}");
                return Default::default();
            }
        };
        let (mut own, mut moved, mut absolute) = (Vec::new(), Vec::new(), Vec::new());
        for (key, record) in records {
            let path = filter.path_of_key(&key);
            if self.folders_dir.is_some() && key.starts_with(ABSOLUTE_KEY) {
                absolute.push(key);
                moved.push((path, record));
            } else {
                own.push((path, record));
            }
        }
        if !absolute.is_empty()
            && let Err(e) = home.apply(&[], &absolute, true)
        {
            tracing::warn!("index cache: moving content root records failed: {e}");
        }
        (own, moved)
    }

    /// The records of the content roots whose store wasn't read since they entered the scope. A
    /// root that left the scope is read again when it comes back: its files left memory meanwhile.
    pub(crate) fn load_folders(&self, filter: &PathFilter) -> Records {
        if self.folders_dir.is_none() {
            return Vec::new();
        }
        let mut folders = self.folders.lock();
        let roots: Vec<&Path> = filter.extra_roots().collect();
        folders.loaded.retain(|folder| roots.contains(&folder.as_path()));
        let mut out = Vec::new();
        for root in roots {
            if !folders.loaded.insert(root.to_owned()) {
                continue;
            }
            let Some(store) = self.folder(&mut folders, root) else { continue };
            match store.load() {
                Ok(records) => out.extend(records.into_iter().map(|(key, record)| (root.join(key), record))),
                Err(e) => tracing::warn!("index cache load failed for {}: {e}", root.display()),
            }
        }
        out
    }

    /// Compacts every store this index uses.
    pub(crate) fn compact(&self) {
        let folders: Vec<Arc<Store>> = self.folders.lock().open.values().flatten().cloned().collect();
        for store in self.home.iter().chain(&folders) {
            if let Err(e) = store.compact() {
                tracing::debug!("index compact: {e}");
            }
        }
    }
}
