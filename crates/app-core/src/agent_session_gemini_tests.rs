use crate::agent_session_header::parse_text;
use crate::agent_session_index::{delete_sessions, list_sessions, session_roots, SessionAgent};
use serde_json::json;
use std::fs;
use std::path::Path;

const ID_A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CHAT: &str = "session-2026-11-01T10-00-abcd1234";

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("test path has a parent")).expect("create parent");
    fs::write(path, text).expect("write test file");
}

/// `~/.gemini` with a Gemini CLI chat, agy's `antigravity-cli`, the IDE's `antigravity`, plus noise.
fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("temp home");
    let gemini = home.path().join(".gemini");
    let project = gemini.join("tmp/app");
    write(&project.join(".project_root"), "D:\\work\\app\n");
    let chat = [
        json!({ "sessionId": ID_A, "projectHash": "x", "kind": "main" }),
        json!({ "id": ID_B, "type": "info", "content": "Loaded" }),
        json!({ "id": ID_B, "type": "user", "content": [{ "text": "Explain   the parser" }] }),
    ]
    .iter()
    .map(ToString::to_string)
    .collect::<Vec<_>>()
    .join("\n");
    write(&project.join("chats").join(format!("{CHAT}.jsonl")), &chat);
    write(&project.join("chats/notes.txt"), "not a chat");
    write(&project.join("logs.json"), "[]");

    let cli = gemini.join("antigravity-cli");
    write(&cli.join("conversations").join(format!("{ID_A}.db")), "db");
    write(&cli.join("conversations/not-a-uuid.db"), "db");
    write(&cli.join("brain").join(ID_A).join("task.md"), "x");
    write(&cli.join("annotations").join(format!("{ID_A}.pbtxt")), "x");
    write(&cli.join("presence").join(format!("{ID_A}.lock")), "");
    write(&cli.join("brain").join(ID_B).join("task.md"), "keep");

    let ide = gemini.join("antigravity");
    write(&ide.join("conversations").join(format!("{ID_B}.db")), "db");
    write(&ide.join("conversations").join(format!("{ID_B}.pb")), "pb");
    fs::create_dir_all(gemini.join("antigravity-browser-profile")).expect("no conversations");
    fs::create_dir_all(home.path().join(".antigravity/extensions")).expect("extensions only");
    home
}

#[test]
fn finds_gemini_and_antigravity_profiles_that_hold_conversations() {
    let home = home();
    let names: Vec<_> = session_roots(home.path())
        .into_iter()
        .map(|root| (root.agent, root.profile))
        .collect();
    assert_eq!(
        names,
        vec![
            (SessionAgent::Gemini, "gemini".to_string()),
            (SessionAgent::Agy, "antigravity".to_string()),
            (SessionAgent::Agy, "antigravity-cli".to_string()),
        ]
    );
}

#[test]
fn a_gemini_folder_without_chats_lists_no_gemini_profile() {
    let home = tempfile::tempdir().expect("temp home");
    fs::create_dir_all(home.path().join(".gemini/antigravity-cli")).expect("no conversations");
    assert!(session_roots(home.path()).is_empty());
}

#[test]
fn lists_gemini_chats_and_antigravity_conversations() {
    let home = home();
    let sessions = list_sessions(&session_roots(home.path()));
    let mut ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec![
            format!("agy:antigravity-cli:{ID_A}"),
            format!("agy:antigravity:{ID_B}"),
            format!("gemini:gemini:{CHAT}"),
        ]
    );
    let chat = sessions
        .iter()
        .find(|s| s.agent == SessionAgent::Gemini)
        .expect("gemini chat");
    assert_eq!(chat.cwd.as_deref(), Some("D:\\work\\app"));
    assert_eq!(chat.title.as_deref(), Some("Explain the parser"));
    let agy = sessions
        .iter()
        .find(|s| s.session_id == ID_B)
        .expect("agy conversation");
    assert_eq!((agy.size, agy.title.as_deref()), (2, None));
}

#[test]
fn deletes_an_antigravity_conversation_with_its_companions_only() {
    let home = home();
    let cli = home.path().join(".gemini/antigravity-cli");
    let roots = session_roots(home.path());
    let report = delete_sessions(
        &roots,
        &[
            format!("agy:antigravity-cli:{ID_A}"),
            "agy:antigravity-cli:not-a-uuid".to_string(),
        ],
    );
    assert_eq!(report.deleted, vec![format!("agy:antigravity-cli:{ID_A}")]);
    assert_eq!(report.failed.len(), 1);
    assert!(!cli
        .join("conversations")
        .join(format!("{ID_A}.db"))
        .exists());
    assert!(!cli.join("brain").join(ID_A).exists());
    assert!(!cli
        .join("annotations")
        .join(format!("{ID_A}.pbtxt"))
        .exists());
    assert!(!cli.join("presence").join(format!("{ID_A}.lock")).exists());
    assert!(cli.join("conversations/not-a-uuid.db").exists());
    assert!(cli.join("brain").join(ID_B).join("task.md").exists());
}

#[test]
fn deleting_an_antigravity_conversation_removes_both_formats() {
    let home = home();
    let ide = home.path().join(".gemini/antigravity/conversations");
    let report = delete_sessions(
        &session_roots(home.path()),
        &[format!("agy:antigravity:{ID_B}")],
    );
    assert!(report.failed.is_empty());
    assert!(!ide.join(format!("{ID_B}.db")).exists());
    assert!(!ide.join(format!("{ID_B}.pb")).exists());
}

#[test]
fn deletes_a_gemini_chat_and_keeps_the_project_folder() {
    let home = home();
    let project = home.path().join(".gemini/tmp/app");
    let report = delete_sessions(
        &session_roots(home.path()),
        &[format!("gemini:gemini:{CHAT}")],
    );
    assert_eq!(report.deleted.len(), 1);
    assert!(!project.join("chats").join(format!("{CHAT}.jsonl")).exists());
    assert!(project.join("chats/notes.txt").exists());
    assert!(project.join(".project_root").exists());
}

#[test]
fn gemini_header_takes_the_first_typed_prompt() {
    let text = [
        json!({ "type": "user", "content": "<context>x</context>" }),
        json!({ "type": "gemini", "content": "Hello" }),
        json!({ "type": "user", "content": "  Fix   it " }),
    ]
    .iter()
    .map(ToString::to_string)
    .collect::<Vec<_>>()
    .join("\n");
    let header = parse_text(&text, SessionAgent::Gemini);
    assert_eq!(header.title.as_deref(), Some("Fix it"));
    assert_eq!(header.cwd, None);
    assert_eq!(parse_text(&text, SessionAgent::Agy), Default::default());
}

#[test]
fn a_gemini_project_root_that_is_not_one_path_is_ignored() {
    let home = home();
    let project = home.path().join(".gemini/tmp/app");
    write(&project.join(".project_root"), "a\nb\n");
    let sessions = list_sessions(&session_roots(home.path()));
    let chat = sessions
        .iter()
        .find(|s| s.agent == SessionAgent::Gemini)
        .expect("gemini chat");
    assert_eq!(chat.cwd, None);
}
