use std::process::{Command, Stdio};
use std::time::Duration;

use session_protocol::{PersistencePolicy, SessionLifecycle};

use crate::manifest::{self, SessionManifest};
use crate::suspend;

#[test]
#[cfg(unix)]
fn boot_sweep_kills_only_verified_frozen_orphans() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = Command::new("/bin/sh")
        .args(["-c", "sleep 30"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn orphan stand-in");
    std::thread::sleep(Duration::from_millis(300));
    let pid = child.id();
    let start_time = suspend::process_start_time(pid).expect("start time for live pid");

    let mut record = SessionManifest::live(
        "orphan".to_string(),
        1,
        PersistencePolicy::FreezeWhileClosed,
        "freeze-test".to_string(),
        false,
        false,
        false,
    );
    record.frozen = true;
    record.pid = Some(pid);
    record.start_time = Some(start_time);
    manifest::write(dir.path(), &record).expect("write manifest");

    // A frozen record whose start time does not match must survive the sweep.
    let mut mismatched = record.clone();
    mismatched.id = "mismatch".to_string();
    mismatched.start_time = Some(start_time.saturating_sub(10_000));
    manifest::write(dir.path(), &mismatched).expect("write mismatched manifest");

    let manager = crate::manager::SessionManager::new(dir.path().to_path_buf())
        .expect("manager triggers the sweep");

    std::thread::sleep(Duration::from_millis(300));
    assert!(
        child.try_wait().expect("status readable").is_some(),
        "verified frozen orphan must be killed on boot"
    );
    let surviving = manager
        .list()
        .into_iter()
        .find(|session| session.id == "mismatch")
        .expect("unverified record must survive as Interrupted");
    assert_eq!(surviving.lifecycle, SessionLifecycle::Interrupted);
}
