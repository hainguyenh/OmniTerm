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
