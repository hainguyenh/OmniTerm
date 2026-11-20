//! Which persisted manifests survive a daemon restart.

use super::*;

fn write_record(state_dir: &Path, id: &str, version: u32, policy: &str, lifecycle: &str) {
    let dir = manifests_dir(state_dir);
    fs::create_dir_all(&dir).expect("manifest directory must be created");
    let record = serde_json::json!({
        "version": version,
        "id": id,
        "generation": 2,
        "policy": policy,
        "lifecycle": lifecycle,
        "label": id,
        "busy": false,
        "launchedWithCommand": false,
        "ssh": false,
    });
    fs::write(manifest_path(state_dir, id), record.to_string()).expect("manifest must be written");
}

fn surviving_ids(state_dir: &Path) -> Vec<String> {
    let mut ids: Vec<_> = load_interrupted(state_dir)
        .into_iter()
        .map(|manifest| {
            assert_eq!(manifest.lifecycle, SessionLifecycle::Interrupted);
            manifest.id
        })
        .collect();
    ids.sort();
    ids
}

#[test]
fn load_interrupted_returns_nothing_without_a_manifest_directory() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load_interrupted(dir.path()).is_empty());
}

#[test]
fn load_interrupted_ignores_manifests_from_another_version() {
    let dir = tempfile::tempdir().unwrap();
    write_record(
        dir.path(),
        "future",
        MANIFEST_VERSION + 1,
        "keep-running",
        "live",
    );
    assert!(load_interrupted(dir.path()).is_empty());
}

#[test]
fn live_sessions_of_any_policy_survive_a_restart_as_interrupted() {
    let dir = tempfile::tempdir().unwrap();
    write_record(dir.path(), "keep", MANIFEST_VERSION, "keep-running", "live");
    write_record(
        dir.path(),
        "close",
        MANIFEST_VERSION,
        "close-with-app",
        "live",
    );
    assert_eq!(surviving_ids(dir.path()), ["close", "keep"]);
    // The rewrite on disk keeps them as interrupted only while their policy allows it.
    assert!(surviving_ids(dir.path()).is_empty());
}

#[test]
fn ended_sessions_survive_only_when_they_recover_after_reboot() {
    let dir = tempfile::tempdir().unwrap();
    let recover = "recover-after-reboot";
    write_record(dir.path(), "closed", MANIFEST_VERSION, recover, "closed");
    write_record(dir.path(), "failed", MANIFEST_VERSION, recover, "error");
    write_record(
        dir.path(),
        "kept",
        MANIFEST_VERSION,
        "keep-running",
        "closed",
    );
    write_record(
        dir.path(),
        "dropped",
        MANIFEST_VERSION,
        "close-with-app",
        "error",
    );
    assert_eq!(surviving_ids(dir.path()), ["closed", "failed"]);
    // Recoverable records stay restorable across repeated restarts.
    assert_eq!(surviving_ids(dir.path()), ["closed", "failed"]);
}

#[test]
fn a_corrupt_manifest_is_quarantined_and_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let path = manifest_path(dir.path(), "broken");
    fs::create_dir_all(manifests_dir(dir.path())).unwrap();
    fs::write(&path, b"{ not json").unwrap();
    assert!(load_interrupted(dir.path()).is_empty());
    assert!(!path.exists());
    let quarantined: Vec<_> = fs::read_dir(manifests_dir(dir.path()))
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
        .collect();
    assert_eq!(quarantined.len(), 1);
}

#[test]
fn summary_reports_the_record_without_a_live_pid() {
    let record = SessionManifest::live(
        "s".into(),
        5,
        PersistencePolicy::RecoverAfterReboot,
        "label".into(),
        true,
        true,
        true,
    );
    let summary = record.summary();
    assert_eq!(summary.id, "s");
    assert_eq!(summary.generation, 5);
    assert_eq!(summary.lifecycle, SessionLifecycle::Live);
    assert_eq!(summary.pid, None);
    assert!(summary.busy && summary.launched_with_command && summary.ssh);
    assert!(!summary.frozen);
}
