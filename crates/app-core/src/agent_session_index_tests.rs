use super::*;
use crate::agent_session_header::parse_text;
use serde_json::{json, Value};
use std::fs;

const ID_A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ID_C: &str = "16fd2706-8baf-433b-82eb-8c7fada847da";

fn lines(records: &[Value]) -> String {
    records
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("test path has a parent")).expect("create parent");
    fs::write(path, text).expect("write test file");
}

fn claude_transcript(cwd: &str, prompt: &str) -> String {
    lines(&[
        json!({ "type": "summary", "summary": "x" }),
        json!({ "type": "user", "isMeta": true, "cwd": cwd, "message": { "content": "<command-name>/clear</command-name>" } }),
        json!({ "type": "user", "cwd": cwd, "message": { "content": [{ "type": "text", "text": prompt }] } }),
    ])
}

/// `~/.claude`, `~/.claude-work`, `~/claude-profiles/claude-th`, `~/.codex`, plus noise.
fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("temp home");
    let root = home.path();
    write(
        &root
            .join(".claude/projects/D--work-app")
            .join(format!("{ID_A}.jsonl")),
        &claude_transcript("D:\\work\\app", "Fix the build"),
    );
    write(
        &root.join(".claude/projects/D--work-app").join("notes.txt"),
        "not a session",
    );
    write(
        &root
            .join(".claude-work/projects/E--site")
            .join(format!("{ID_B}.jsonl")),
        &claude_transcript("E:\\site", "Add tests"),
    );
    fs::create_dir_all(root.join("claude-profiles/claude-th/projects")).expect("profile dir");
    fs::create_dir_all(root.join("claude-profiles/bad name")).expect("ignored profile dir");
    write(&root.join(".claude-x.json"), "{}");
    let rollout = lines(&[
        json!({ "type": "session_meta", "payload": { "id": ID_C, "cwd": "D:\\work\\api" } }),
        json!({ "type": "response_item", "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "<environment_context>x</environment_context>" }] } }),
        json!({ "type": "response_item", "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Refactor   the\nparser" }] } }),
    ]);
    write(
        &root
            .join(".codex/sessions/2026/11/02")
            .join(format!("rollout-2026-11-02T10-00-00-{ID_C}.jsonl")),
        &rollout,
    );
    home
}

#[test]
fn finds_every_profile_directory_with_unique_names() {
    let home = home();
    let roots = session_roots(home.path());
    let names: Vec<_> = roots
        .iter()
        .map(|root| (root.agent, root.profile.as_str()))
        .collect();
    assert_eq!(
        names,
        vec![
            (SessionAgent::Claude, "claude"),
            (SessionAgent::Codex, "codex"),
            (SessionAgent::Claude, "claude-work"),
            (SessionAgent::Claude, "claude-th"),
        ]
    );
}

#[test]
fn numbers_a_profile_name_found_twice() {
    let home = tempfile::tempdir().expect("temp home");
    fs::create_dir_all(home.path().join(".claude-work")).expect("dot profile");
    fs::create_dir_all(home.path().join("claude-profiles/work")).expect("profiles dir");
    let profiles: Vec<_> = session_roots(home.path())
        .into_iter()
        .map(|root| root.profile)
        .collect();
    assert_eq!(profiles, vec!["claude-work", "claude-work (2)"]);
}

#[test]
fn lists_sessions_newest_first_with_their_head() {
    let home = home();
    let roots = session_roots(home.path());
    let sessions = list_sessions(&roots);
    let mut ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec![
            format!("claude:claude-work:{ID_B}"),
            format!("claude:claude:{ID_A}"),
            format!("codex:codex:{ID_C}")
        ]
    );
    assert!(sessions
        .windows(2)
        .all(|pair| pair[0].last_active >= pair[1].last_active));

    let claude = sessions
        .iter()
        .find(|s| s.session_id == ID_A)
        .expect("claude session");
    assert_eq!(claude.cwd.as_deref(), Some("D:\\work\\app"));
    assert_eq!(claude.title.as_deref(), Some("Fix the build"));
    assert!(claude.size > 0);
    let codex = sessions
        .iter()
        .find(|s| s.agent == SessionAgent::Codex)
        .expect("codex session");
    assert_eq!(codex.session_id, ID_C);
    assert_eq!(codex.cwd.as_deref(), Some("D:\\work\\api"));
    assert_eq!(codex.title.as_deref(), Some("Refactor the parser"));
}

#[test]
fn deletes_a_listed_claude_session_with_its_companions_only() {
    let home = home();
    let root = home.path().join(".claude");
    let project = root.join("projects/D--work-app");
    write(&project.join(ID_A).join("subagents/a.jsonl"), "{}");
    write(&root.join("file-history").join(ID_A).join("v1"), "x");
    write(
        &root.join("todos").join(format!("{ID_A}-agent-{ID_A}.json")),
        "[]",
    );
    write(
        &root.join("todos").join(format!("{ID_B}-agent-{ID_B}.json")),
        "[]",
    );
    let roots = session_roots(home.path());

    let report = delete_sessions(
        &roots,
        &[
            format!("claude:claude:{ID_A}"),
            "claude:claude:../../etc".to_string(),
        ],
    );

    assert_eq!(report.deleted, vec![format!("claude:claude:{ID_A}")]);
    assert_eq!(
        report.failed,
        vec![(
            "claude:claude:../../etc".to_string(),
            "Session not found".to_string()
        )]
    );
    assert!(!project.join(format!("{ID_A}.jsonl")).exists());
    assert!(!project.join(ID_A).exists());
    assert!(!root.join("file-history").join(ID_A).exists());
    assert!(!root
        .join("todos")
        .join(format!("{ID_A}-agent-{ID_A}.json"))
        .exists());
    assert!(root
        .join("todos")
        .join(format!("{ID_B}-agent-{ID_B}.json"))
        .exists());
    assert!(project.join("notes.txt").exists());
    assert_eq!(list_sessions(&roots).len(), 2);
}

#[test]
fn deletes_a_codex_rollout() {
    let home = home();
    let roots = session_roots(home.path());
    let report = delete_sessions(&roots, &[format!("codex:codex:{ID_C}")]);
    assert_eq!(report.deleted.len(), 1);
    assert!(list_sessions(&roots)
        .iter()
        .all(|s| s.agent != SessionAgent::Codex));
}

#[test]
fn header_skips_meta_sidechain_and_wrapped_prompts() {
    let text = lines(&[
        json!({ "type": "user", "isSidechain": true, "cwd": "C:\\a", "message": { "content": "sub-agent prompt" } }),
        json!({ "type": "user", "message": { "content": "Caveat: the messages below" } }),
        json!({ "type": "user", "message": { "content": "  Real   prompt  " } }),
    ]);
    let header = parse_text(&text, SessionAgent::Claude);
    assert_eq!(header.cwd.as_deref(), Some("C:\\a"));
    assert_eq!(header.title.as_deref(), Some("Real prompt"));
}

#[test]
fn header_shortens_long_prompts_and_survives_garbage() {
    let long = "x".repeat(300);
    let text = format!(
        "not json\n{}",
        json!({ "type": "user", "message": { "content": long } })
    );
    let title = parse_text(&text, SessionAgent::Claude)
        .title
        .expect("title");
    assert_eq!(title.chars().count(), 121);
    assert!(title.ends_with('…'));
    assert_eq!(
        parse_text("", SessionAgent::Codex),
        crate::agent_session_header::SessionHeader::default()
    );
}

#[test]
fn header_reads_the_first_codex_rollout_format() {
    let text = lines(&[json!({ "id": ID_C, "cwd": "/home/me/app", "timestamp": "2025-01-01" })]);
    let header = parse_text(&text, SessionAgent::Codex);
    assert_eq!(header.session_id.as_deref(), Some(ID_C));
    assert_eq!(header.cwd.as_deref(), Some("/home/me/app"));
}

#[test]
fn ignores_invalid_profile_suffixes_and_profile_files() {
    let home = tempfile::tempdir().expect("temp home");
    let root = home.path();
    for dir in [
        ".claude-".to_string(),
        format!(".claude-{}", "a".repeat(PROFILE_SUFFIX_MAX + 1)),
        ".claude-has space".to_string(),
        ".codex-v1.2_beta".to_string(),
        "claude-profiles/claude-".to_string(),
    ] {
        fs::create_dir_all(root.join(dir)).expect("profile dir");
    }
    write(&root.join(".codex-file"), "not a dir");
    write(&root.join("claude-profiles/solo"), "not a dir");

    let roots = session_roots(root);
    let profiles: Vec<_> = roots
        .iter()
        .map(|root| (root.agent, root.profile.as_str()))
        .collect();
    assert_eq!(profiles, vec![(SessionAgent::Codex, "codex-v1.2_beta")]);
}

#[test]
fn codex_rollout_without_an_id_is_named_after_its_file() {
    let home = tempfile::tempdir().expect("temp home");
    write(
        &home
            .path()
            .join(".codex/sessions/2026/01/02/rollout-plain.jsonl"),
        &lines(&[json!({ "type": "session_meta", "payload": { "cwd": "/srv" } })]),
    );
    let sessions = list_sessions(&session_roots(home.path()));
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "rollout-plain");
    assert_eq!(sessions[0].id, "codex:codex:rollout-plain");
    assert_eq!(sessions[0].cwd.as_deref(), Some("/srv"));
}

#[test]
fn sessions_with_the_same_age_are_ordered_by_id() {
    let home = tempfile::tempdir().expect("temp home");
    let project = home.path().join(".claude/projects/p");
    let stamp = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    for id in [ID_B, ID_A] {
        let path = project.join(format!("{id}.jsonl"));
        write(&path, &claude_transcript("/w", "hi"));
        fs::File::options()
            .write(true)
            .open(&path)
            .expect("open transcript")
            .set_modified(stamp)
            .expect("set mtime");
    }
    let sessions = list_sessions(&session_roots(home.path()));
    let ids: Vec<_> = sessions.iter().map(|s| s.session_id.as_str()).collect();
    assert_eq!(ids, vec![ID_A, ID_B]);
    assert_eq!(sessions[0].last_active, 1_700_000_000_000);
}

/// Regression: a "7+ days" cleanup scan found nothing because the newest sessions were kept first.
#[test]
fn an_idle_listing_keeps_only_sessions_idle_long_enough() {
    let home = tempfile::tempdir().expect("temp home");
    let project = home.path().join(".claude/projects/p");
    let now = std::time::SystemTime::now();
    let day = std::time::Duration::from_secs(86_400);
    for (id, age) in [(ID_A, day * 10), (ID_B, day * 2)] {
        let path = project.join(format!("{id}.jsonl"));
        write(&path, &claude_transcript("/w", "hi"));
        fs::File::options()
            .write(true)
            .open(&path)
            .expect("open transcript")
            .set_modified(now - age)
            .expect("set mtime");
    }
    let roots = session_roots(home.path());
    assert_eq!(list_sessions(&roots).len(), 2);
    let week = 7 * 86_400_000;
    let old: Vec<_> = list_sessions_idle(&roots, week)
        .into_iter()
        .map(|s| s.session_id)
        .collect();
    assert_eq!(old, vec![ID_A.to_string()]);
    assert!(list_sessions_idle(&roots, 30 * 86_400_000).is_empty());
}

#[test]
fn deleting_a_non_uuid_claude_session_leaves_same_named_entries() {
    let home = tempfile::tempdir().expect("temp home");
    let root = home.path().join(".claude");
    let project = root.join("projects/p");
    write(&project.join("draft.jsonl"), &claude_transcript("/w", "hi"));
    write(&project.join("draft").join("keep.txt"), "x");
    write(&root.join("file-history/draft/v1"), "x");

    let report = delete_sessions(
        &session_roots(home.path()),
        &["claude:claude:draft".to_string()],
    );

    assert_eq!(report.deleted, vec!["claude:claude:draft".to_string()]);
    assert!(report.failed.is_empty());
    assert!(!project.join("draft.jsonl").exists());
    assert!(project.join("draft/keep.txt").exists());
    assert!(root.join("file-history/draft/v1").exists());
}

#[test]
fn remove_owned_removes_files_and_dirs_and_ignores_missing_entries() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("a.txt");
    let folder = dir.path().join("nested");
    write(&file, "x");
    write(&folder.join("b.txt"), "y");

    remove_owned(&file).expect("remove file");
    remove_owned(&folder).expect("remove dir");
    remove_owned(&dir.path().join("missing")).expect("missing is fine");
    assert!(!file.exists());
    assert!(!folder.exists());
}

#[cfg(unix)]
#[test]
fn remove_owned_leaves_symlinks_and_their_targets() {
    let dir = tempfile::tempdir().expect("temp dir");
    let target = dir.path().join("target.txt");
    let link = dir.path().join("link.txt");
    write(&target, "x");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    remove_owned(&link).expect("symlink is skipped");
    assert!(fs::symlink_metadata(&link).is_ok());
    assert!(target.exists());
}

#[cfg(unix)]
#[test]
fn a_transcript_with_a_non_unicode_name_is_not_listed() {
    use std::os::unix::ffi::OsStrExt;
    let home = tempfile::tempdir().expect("temp home");
    let project = home.path().join(".claude/projects/p");
    let odd = project.join(std::ffi::OsStr::from_bytes(b"\xff.jsonl"));
    write(&odd, &claude_transcript("/w", "hi"));

    let roots = session_roots(home.path());
    assert!(list_sessions(&roots).is_empty());
    assert!(odd.exists());
}

#[test]
fn deletes_a_codex_rollout_whose_file_name_does_not_hold_its_id() {
    let home = tempfile::tempdir().expect("temp home");
    let rollout = home
        .path()
        .join(".codex/sessions/2026/01/02/rollout-plain.jsonl");
    write(
        &rollout,
        &lines(&[json!({ "type": "session_meta", "payload": { "id": ID_C } })]),
    );
    let report = delete_sessions(
        &session_roots(home.path()),
        &[format!("codex:codex:{ID_C}")],
    );
    assert_eq!(report.deleted, vec![format!("codex:codex:{ID_C}")]);
    assert!(!rollout.exists());
}
