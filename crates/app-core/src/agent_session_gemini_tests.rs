use crate::agent_session_index::{delete_sessions, list_sessions, session_roots, SessionAgent};
use serde_json::json;
use std::fs;
use std::path::Path;

const ID_A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("test path has a parent")).expect("create parent");
    fs::write(path, text).expect("write test file");
}

/// `~/.gemini` with agy's `antigravity-cli` and the IDE's `antigravity`, plus noise: a Gemini CLI
/// chat folder (no longer indexed), a folder without conversations and an extensions-only folder.
fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("temp home");
    let gemini = home.path().join(".gemini");
    let project = gemini.join("tmp/app");
    write(&project.join(".project_root"), "D:\\work\\app\n");
    write(
        &project.join("chats/session-2026-11-01T10-00-abcd1234.jsonl"),
        &json!({ "type": "user", "content": "Explain the parser" }).to_string(),
    );

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
fn finds_antigravity_profiles_and_skips_gemini_cli_chats() {
    let home = home();
    let names: Vec<_> = session_roots(home.path())
        .into_iter()
        .map(|root| (root.agent, root.profile))
        .collect();
    assert_eq!(
        names,
        vec![
            (SessionAgent::Agy, "antigravity".to_string()),
            (SessionAgent::Agy, "antigravity-cli".to_string()),
        ]
    );
}

#[test]
fn a_gemini_folder_without_conversations_lists_no_profile() {
    let home = tempfile::tempdir().expect("temp home");
    fs::create_dir_all(home.path().join(".gemini/antigravity-cli")).expect("no conversations");
    fs::create_dir_all(home.path().join(".gemini/tmp/app/chats")).expect("gemini cli folder");
    assert!(session_roots(home.path()).is_empty());
}

#[test]
fn lists_antigravity_conversations_only() {
    let home = home();
    let sessions = list_sessions(&session_roots(home.path()));
    let mut ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec![
            format!("agy:antigravity-cli:{ID_A}"),
            format!("agy:antigravity:{ID_B}"),
        ]
    );
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
fn a_gemini_cli_chat_id_is_not_deleted() {
    let home = home();
    let chat = home
        .path()
        .join(".gemini/tmp/app/chats/session-2026-11-01T10-00-abcd1234.jsonl");
    let report = delete_sessions(
        &session_roots(home.path()),
        &["gemini:gemini:session-2026-11-01T10-00-abcd1234".to_string()],
    );
    assert!(report.deleted.is_empty());
    assert!(chat.exists());
}
