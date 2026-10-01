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
    let resolved_trailing = resolve_claude_session_file(profile_dir, "D:\\work\\proj\\", None);
    assert_eq!(
        resolved_trailing.as_deref(),
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
async fn command_rejects_blank_inputs_and_resolves_valid_session() {
    let resolved_profile = resolve_claude_session(String::new(), "D:\\work".to_string(), None)
        .await
        .expect("command should not error");
    assert_eq!(resolved_profile, None);

    let resolved_cwd = resolve_claude_session("profile".to_string(), "   ".to_string(), None)
        .await
        .expect("command should not error");
    assert_eq!(resolved_cwd, None);

    let temp = tempdir().expect("tempdir");
    let profile_dir = temp.path();
    let project_dir = profile_dir.join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");
    touch_at(
        &project_dir.join("33333333-3333-3333-3333-333333333333.jsonl"),
        SystemTime::now(),
    );
    let resolved = resolve_claude_session(
        profile_dir.to_string_lossy().to_string(),
        "D:\\work\\proj".to_string(),
        None,
    )
    .await
    .expect("resolve valid session");
    assert_eq!(
        resolved.as_deref(),
        Some("33333333-3333-3333-3333-333333333333")
    );
}

#[test]
fn session_lookup_skips_non_jsonl_and_handles_older_files() {
    let temp = tempdir().expect("tempdir");
    let profile_dir = temp.path();
    let project_dir = profile_dir.join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");

    let now = SystemTime::now();
    touch_at(&project_dir.join("not-jsonl.txt"), now);
    touch_at(&project_dir.join("no-extension"), now);

    touch_at(
        &project_dir.join("11111111-1111-1111-1111-111111111111.jsonl"),
        now - Duration::from_secs(60),
    );
    touch_at(
        &project_dir.join("22222222-2222-2222-2222-222222222222.jsonl"),
        now,
    );
    touch_at(
        &project_dir.join("00000000-0000-0000-0000-000000000000.jsonl"),
        now - Duration::from_secs(120),
    );

    let since = now
        .duration_since(UNIX_EPOCH)
        .expect("since epoch")
        .as_secs()
        - 30;
    let resolved = resolve_claude_session_file(profile_dir, "D:\\work\\proj", Some(since));
    assert_eq!(
        resolved.as_deref(),
        Some("22222222-2222-2222-2222-222222222222")
    );

    assert_eq!(
        resolve_claude_session_file(profile_dir, "D:\\missing\\proj", None),
        None
    );
}

#[test]
fn durable_session_commands_round_trip_through_app_data() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let document = serde_json::json!({
        "sessions": [{ "id": "claude:session" }],
        "pins": []
    });

    tauri::async_runtime::block_on(agent_sessions_save(app.handle().clone(), document.clone()))
        .expect("session document should save");
    assert_eq!(
        tauri::async_runtime::block_on(agent_sessions_load(app.handle().clone()))
            .expect("session document should load"),
        Some(document)
    );
    if let Ok(path) = store_path(app.handle()) {
        let _ = fs::remove_file(path);
    }
}

#[tokio::test]
async fn transcript_export_rejects_non_uuid_ids_and_renders_the_session() {
    let temp = tempdir().expect("tempdir");
    let profile = temp.path().to_string_lossy().to_string();
    for bad in ["../secret", "latest", ""] {
        assert!(
            export_claude_transcript(profile.clone(), bad.to_string())
                .await
                .is_err(),
            "{bad:?} must be rejected"
        );
    }

    let project_dir = temp.path().join("projects").join("D--work-proj");
    fs::create_dir_all(&project_dir).expect("create project dir");
    let id = "44444444-4444-4444-4444-444444444444";
    let record =
        serde_json::json!({ "type": "user", "message": { "content": "Full conversation" } });
    fs::write(project_dir.join(format!("{id}.jsonl")), record.to_string())
        .expect("write transcript");

    let text = export_claude_transcript(profile, id.to_string())
        .await
        .expect("export valid session");
    assert!(text.contains("Full conversation"), "{text}");
}
