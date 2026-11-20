use super::super::{list_sessions, session_roots};
use super::purge_probe_sessions;
use serde_json::json;
use std::fs;
use std::path::Path;

const PROBE: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TYPED: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ELSEWHERE: &str = "16fd2706-8baf-433b-82eb-8c7fada847da";
const NOW: u64 = u64::MAX / 2;

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("test path has a parent")).expect("create parent");
    fs::write(path, text).expect("write test file");
}

/// What a probe run leaves: the owner record Claude writes on start, and no prompt.
fn owner_only(id: &str) -> String {
    json!({ "type": "session-owner", "sessionId": id }).to_string()
}

fn prompted(id: &str) -> String {
    json!({ "type": "user", "sessionId": id, "cwd": "C:/Temp/omniterm-wake", "message": { "content": "hello" } })
        .to_string()
}

#[test]
fn removes_only_empty_transcripts_in_the_probe_folder_with_their_companions() {
    let home = tempfile::tempdir().expect("temp home");
    let profile = home.path().join(".claude-work");
    let short = profile.join("projects/C--Users-HAI-1-NGU-AppData-Local-Temp-omniterm-wake");
    let long = profile.join("projects/C--Users-hai-nguyen-AppData-Local-Temp-omniterm-wake");
    write(&short.join(format!("{PROBE}.jsonl")), &owner_only(PROBE));
    write(&short.join(PROBE).join("subagents/a.jsonl"), "{}");
    write(&profile.join("file-history").join(PROBE).join("x"), "x");
    write(&long.join(format!("{TYPED}.jsonl")), &prompted(TYPED));
    let other = profile.join("projects/D--work-app");
    write(
        &other.join(format!("{ELSEWHERE}.jsonl")),
        &owner_only(ELSEWHERE),
    );

    let removed = purge_probe_sessions(&session_roots(home.path()), "omniterm-wake", 0, NOW);

    assert_eq!(removed, 1);
    assert!(!short.join(format!("{PROBE}.jsonl")).exists());
    assert!(!short.join(PROBE).exists(), "the sub-agent folder goes too");
    assert!(!profile.join("file-history").join(PROBE).exists());
    assert!(
        long.join(format!("{TYPED}.jsonl")).exists(),
        "a typed prompt is kept"
    );
    assert!(
        other.join(format!("{ELSEWHERE}.jsonl")).exists(),
        "other projects are untouched"
    );
}

#[test]
fn keeps_a_probe_transcript_written_too_recently() {
    let home = tempfile::tempdir().expect("temp home");
    let dir = home.path().join(".claude/projects/C--Temp-omniterm-wake");
    write(&dir.join(format!("{PROBE}.jsonl")), &owner_only(PROBE));
    // Idle far less than the window asked for: a probe may still be running.
    let removed = purge_probe_sessions(&session_roots(home.path()), "omniterm-wake", u64::MAX, NOW);
    assert_eq!(removed, 0);
    assert!(dir.join(format!("{PROBE}.jsonl")).exists());
}

#[test]
fn a_listing_marks_sessions_without_a_prompt_as_empty() {
    let home = tempfile::tempdir().expect("temp home");
    let dir = home.path().join(".claude/projects/D--work-app");
    write(&dir.join(format!("{PROBE}.jsonl")), &owner_only(PROBE));
    write(&dir.join(format!("{TYPED}.jsonl")), &prompted(TYPED));
    let sessions = list_sessions(&session_roots(home.path()));
    let empty = |id: &str| {
        sessions
            .iter()
            .find(|session| session.session_id == id)
            .map(|session| session.empty)
    };
    assert_eq!(empty(PROBE), Some(true));
    assert_eq!(empty(TYPED), Some(false));
}
