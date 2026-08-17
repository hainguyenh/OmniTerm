use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use session_protocol::{PersistencePolicy, SessionLifecycle, SessionSummary};

const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionManifest {
    version: u32,
    pub id: String,
    pub generation: u64,
    pub policy: PersistencePolicy,
    pub lifecycle: SessionLifecycle,
    pub label: String,
    pub busy: bool,
    pub launched_with_command: bool,
    pub ssh: bool,
}

impl SessionManifest {
    pub(crate) fn live(
        id: String,
        generation: u64,
        policy: PersistencePolicy,
        label: String,
        busy: bool,
        launched_with_command: bool,
        ssh: bool,
    ) -> Self {
        Self {
            version: MANIFEST_VERSION,
            id,
            generation,
            policy,
            lifecycle: SessionLifecycle::Live,
            label,
            busy,
            launched_with_command,
            ssh,
        }
    }

    pub(crate) fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.id.clone(),
            generation: self.generation,
            policy: self.policy,
            lifecycle: self.lifecycle,
            pid: None,
            label: self.label.clone(),
            busy: self.busy,
            launched_with_command: self.launched_with_command,
            ssh: self.ssh,
        }
    }
}

pub(crate) fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn manifests_dir(state_dir: &Path) -> PathBuf {
    state_dir.join("sessions")
}

fn manifest_path(state_dir: &Path, id: &str) -> PathBuf {
    manifests_dir(state_dir).join(format!("{:016x}.json", stable_hash(id)))
}

pub(crate) fn write(state_dir: &Path, manifest: &SessionManifest) -> Result<(), String> {
    let dir = manifests_dir(state_dir);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create session manifest directory: {error}"))?;
    let path = manifest_path(state_dir, &manifest.id);
    let data = serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;
    atomic_write(&path, &data, "session manifest")
}

pub(crate) fn atomic_write(path: &Path, data: &[u8], label: &str) -> Result<(), String> {
    let temp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let mut file = fs::File::create(&temp)
        .map_err(|error| format!("Could not create {label}: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure {label}: {error}"))?;
    }
    file.write_all(data)
        .map_err(|error| format!("Could not write {label}: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush {label}: {error}"))?;
    drop(file);
    replace_file(&temp, path).map_err(|error| format!("Could not commit {label}: {error}"))
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temp, path)
}

#[cfg(windows)]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| std::io::Error::other(error))
}

pub(crate) fn remove(state_dir: &Path, id: &str) {
    let _ = fs::remove_file(manifest_path(state_dir, id));
}

fn quarantine_corrupt(path: &Path) {
    let quarantined = path.with_extension(format!("corrupt-{}", uuid::Uuid::new_v4()));
    if let Err(error) = fs::rename(path, &quarantined) {
        log::warn!(
            "[sessiond] could not quarantine corrupt manifest {}: {error}",
            path.display()
        );
    }
}

pub(crate) fn load_interrupted(state_dir: &Path) -> Vec<SessionManifest> {
    let Ok(entries) = fs::read_dir(manifests_dir(state_dir)) else {
        return Vec::new();
    };
    let mut manifests = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(data) = fs::read(&path) else {
            continue;
        };
        let mut manifest = match serde_json::from_slice::<SessionManifest>(&data) {
            Ok(manifest) => manifest,
            Err(_) => {
                quarantine_corrupt(&path);
                continue;
            }
        };
        if manifest.version != MANIFEST_VERSION {
            continue;
        }
        let survives_restart = manifest.lifecycle == SessionLifecycle::Live
            || (manifest.policy == PersistencePolicy::RecoverAfterReboot
                && matches!(
                    manifest.lifecycle,
                    SessionLifecycle::Interrupted
                        | SessionLifecycle::Closed
                        | SessionLifecycle::Error
                ));
        if !survives_restart {
            continue;
        }
        manifest.lifecycle = SessionLifecycle::Interrupted;
        let _ = write(state_dir, &manifest);
        manifests.push(manifest);
    }
    manifests
}
