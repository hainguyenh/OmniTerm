use super::*;
use crate::agent_session_index::session_roots;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

const IDS: [&str; 3] = [
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "16fd2706-8baf-433b-82eb-8c7fada847da",
];

/// `~/.claude` with one transcript per id of [`IDS`], each of a known size.
fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("temp home");
    let project = home.path().join(".claude/projects/D--work-app");
    fs::create_dir_all(&project).expect("project dir");
    for id in IDS {
        fs::write(project.join(format!("{id}.jsonl")), "{}\n{}\n").expect("transcript");
    }
    home
}

fn ids() -> Vec<String> {
    IDS.iter().map(|id| format!("claude:claude:{id}")).collect()
}

#[test]
fn reports_progress_after_every_id_with_the_bytes_freed() {
    let home = home();
    let steps = Mutex::new(Vec::new());
    let cancel = AtomicBool::new(false);
    let record = |step: Step| steps.lock().expect("steps").push(step);
    let report = delete_sessions_with(
        &session_roots(home.path()),
        &ids(),
        &Progress {
            on_step: &record,
            cancel: &cancel,
        },
    );
    assert_eq!(report.deleted, ids());
    let steps = steps.into_inner().expect("steps");
    assert_eq!(steps.iter().map(|s| s.done).collect::<Vec<_>>(), [1, 2, 3]);
    assert!(steps.iter().all(|s| s.total == 3));
    assert_eq!(steps.last().map(|s| s.bytes), Some(18));
}

#[test]
fn cancelling_stops_before_the_next_id_and_reports_the_rest() {
    let home = home();
    let cancel = AtomicBool::new(false);
    // Cancel once the first id is done.
    let stop = |_: Step| cancel.store(true, Ordering::Relaxed);
    let report = delete_sessions_with(
        &session_roots(home.path()),
        &ids(),
        &Progress {
            on_step: &stop,
            cancel: &cancel,
        },
    );
    assert_eq!(report.deleted, ids()[..1]);
    assert_eq!(report.failed.len(), 2);
    assert!(report
        .failed
        .iter()
        .all(|(_, reason)| reason == "Cancelled"));
    let project = home.path().join(".claude/projects/D--work-app");
    assert!(project.join(format!("{}.jsonl", IDS[1])).exists());
}
