use super::*;
use crate::manager::SessionManager;

fn write_manifest(state_dir: &Path, json: &str) {
    let dir = manifests_dir(state_dir);
    std::fs::create_dir_all(&dir).unwrap();
    let name = uuid::Uuid::new_v4().to_string();
    std::fs::write(dir.join(format!("{name}.json")), json).unwrap();
}

#[test]
fn quarantine_corrupt_swallows_rename_failure_without_panicking() {
    // A nonexistent source path causes fs::rename to fail; the function must
    // log the error instead of panicking.
    let phantom = std::env::temp_dir().join(format!(
        "omniterm-quarantine-missing-{}.json",
        uuid::Uuid::new_v4()
    ));
    quarantine_corrupt(&phantom);
    // No assertion: the test passes by not panicking.
}

#[test]
fn load_interrupted_skips_unreadable_subdirectory_entries() {
    let dir = tempfile::tempdir().unwrap();
    let manifests_dir = manifests_dir(dir.path());
    std::fs::create_dir_all(&manifests_dir).unwrap();
    // A nested directory is a valid entries.read_dir() entry, but fs::read
    // on a directory fails on all platforms, exercising the `continue` path.
    std::fs::create_dir_all(manifests_dir.join("subdir")).unwrap();

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.list().is_empty());
}

#[test]
fn load_interrupted_skips_interrupted_keep_running_manifest_without_surviving() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "id": "skipped",
        "generation": 1,
        "policy": "keep-running",
        "lifecycle": "interrupted",
        "label": "skipped",
        "busy": false,
        "launchedWithCommand": false,
        "ssh": false,
    });
    write_manifest(dir.path(), &manifest.to_string());

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.list().is_empty());
}

#[test]
fn load_interrupted_recovers_recover_after_reboot_interrupted_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "id": "persistent",
        "generation": 3,
        "policy": "recover-after-reboot",
        "lifecycle": "interrupted",
        "label": "persistent",
        "busy": false,
        "launchedWithCommand": false,
        "ssh": false,
    });
    write_manifest(dir.path(), &manifest.to_string());

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let sessions = manager.list();
    assert_eq!(sessions.len(), 1);
    let recovered = &sessions[0];
    assert_eq!(recovered.id, "persistent");
    assert_eq!(recovered.generation, 3);
    assert_eq!(recovered.lifecycle, SessionLifecycle::Interrupted);
}

#[test]
fn stable_hash_is_deterministic_and_distinguishes_inputs() {
    let a = stable_hash("session-alpha");
    let b = stable_hash("session-alpha");
    let c = stable_hash("session-beta");
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn atomic_write_round_trips_bytes_through_replace() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("manifest.bin");
    atomic_write(&target, b"payload", "coverage sink").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"payload");
    // Overwriting an existing file must also succeed (MoveFileEx replaces).
    atomic_write(&target, b"second", "coverage sink").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"second");
}

#[test]
fn manifest_without_freeze_fields_reads_as_not_frozen() {
    let legacy = r#"{
        "version": 1,
        "id": "legacy",
        "generation": 1,
        "policy": "keep-running",
        "lifecycle": "live",
        "label": "PowerShell",
        "busy": false,
        "launchedWithCommand": false,
        "ssh": false
    }"#;
    let parsed: SessionManifest = serde_json::from_str(legacy).unwrap();
    assert!(!parsed.frozen);
    assert!(parsed.start_time.is_none());
    assert!(parsed.pid.is_none());
}

#[test]
fn manifest_freeze_fields_round_trip() {
    let mut record = SessionManifest::live(
        "frozen-one".to_string(),
        3,
        PersistencePolicy::FreezeWhileClosed,
        "PowerShell".to_string(),
        false,
        false,
        false,
    );
    record.frozen = true;
    record.pid = Some(4242);
    record.start_time = Some(1_700_000_000);
    let data = serde_json::to_vec(&record).unwrap();
    let parsed: SessionManifest = serde_json::from_slice(&data).unwrap();
    assert!(parsed.frozen);
    assert_eq!(parsed.pid, Some(4242));
    assert_eq!(parsed.start_time, Some(1_700_000_000));
}
