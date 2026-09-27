use super::*;
use std::fs;
use std::time::{Duration, SystemTime};
use tempfile::tempdir;

fn touch_at(path: &Path, when: SystemTime) {
    fs::write(path, "{}").expect("write session file");
    let file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open session file for write");
    file.set_modified(when).expect("set mtime");
}

#[test]
fn is_uuid_accepts_only_strict_form() {
    assert!(is_uuid("11111111-1111-1111-1111-111111111111"));
    assert!(is_uuid("AbCdEf01-2345-6789-aBcD-Ef0123456789"));
    assert!(!is_uuid("not-a-uuid"));
    assert!(!is_uuid("11111111-1111-1111-1111-11111111111")); // 35 chars
    assert!(!is_uuid("{11111111-1111-1111-1111-111111111111}"));
    // A shell-injection attempt shaped like a file stem must never pass.
    assert!(!is_uuid("x & calc & aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
}

#[test]
fn encode_project_dir_matches_claude_cli() {
    assert_eq!(
        encode_project_dir("D:\\workspace\\OmniTerm"),
        "D--workspace-OmniTerm"
    );
    assert_eq!(
        encode_project_dir("/home/user/project"),
        "-home-user-project"
    );
}

#[test]
fn resolves_newest_uuid_named_session() {
    let temp = tempdir().expect("tempdir");
    let profile_dir = temp.path();
    let project_dir = profile_dir.join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");

    let now = SystemTime::now();
    touch_at(
        &project_dir.join("11111111-1111-1111-1111-111111111111.jsonl"),
        now - Duration::from_secs(120),
    );
    touch_at(
        &project_dir.join("22222222-2222-2222-2222-222222222222.jsonl"),
        now,
    );

    let resolved = resolve_claude_session_file(profile_dir, "D:\\work\\proj", None);
    assert_eq!(
        resolved.as_deref(),
        Some("22222222-2222-2222-2222-222222222222")
    );
}

#[test]
fn ignores_non_uuid_file_names() {
    let temp = tempdir().expect("tempdir");
    let profile_dir = temp.path();
    let project_dir = profile_dir.join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");

    // A file name shaped to look like a shell command must never be returned as a session id.
    touch_at(
        &project_dir.join("x & calc & padding-padding-pad.jsonl"),
        SystemTime::now(),
    );

    assert_eq!(
        resolve_claude_session_file(profile_dir, "D:\\work\\proj", None),
        None
    );
}

#[test]
fn ignores_sessions_older_than_the_agent_process() {
    let temp = tempdir().expect("tempdir");
    let profile_dir = temp.path();
    let project_dir = profile_dir.join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");

    let now = SystemTime::now();
    let old_file = project_dir.join("11111111-1111-1111-1111-111111111111.jsonl");
    touch_at(&old_file, now - Duration::from_secs(3600));

    let since = now
        .duration_since(UNIX_EPOCH)
        .expect("since epoch")
        .as_secs();
    assert_eq!(
        resolve_claude_session_file(profile_dir, "D:\\work\\proj", Some(since)),
        None
    );
}

#[tokio::test]
async fn command_rejects_blank_inputs() {
    let resolved = resolve_claude_session(String::new(), "D:\\work".to_string(), None)
        .await
        .expect("command should not error");
    assert_eq!(resolved, None);
}

#[tokio::test]
async fn durable_session_commands_round_trip_through_app_data() {
    let app = crate::test_support::mock_app();
    let document = serde_json::json!({
        "sessions": [{ "id": "claude:session" }],
        "pins": []
    });

    agent_sessions_save(app.handle().clone(), document.clone())
        .await
        .expect("session document should save");
    assert_eq!(
        agent_sessions_load(app.handle().clone())
            .await
            .expect("session document should load"),
        Some(document)
    );
}
