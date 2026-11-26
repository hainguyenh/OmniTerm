//! IPC argument decoding for the commands `ipc_rejects_malformed_payloads_before_commands_can_act`
//! does not list: a wrongly typed or missing argument must be refused before the command body runs.

use super::IpcApp;
use serde_json::json;

#[test]
fn ipc_rejects_mistyped_arguments_before_any_command_body_runs() {
    let fixture = IpcApp::new();
    let malformed = [
        ("ide_set_project", json!({ "workspaceId": 7 })),
        ("interrupt_session", json!({ "id": 7 })),
        (
            "report_detached_terminal_context",
            json!({ "sessionId": 7, "cwd": null, "title": null }),
        ),
        ("import_settings", json!({ "envelope": {}, "strategy": 1 })),
        ("import_settings", json!({ "strategy": "merge" })),
        (
            "remove_workspace_folder",
            json!({ "workspaceId": "x", "folderId": 1 }),
        ),
        (
            "rename_workspace_folder",
            json!({ "workspaceId": "x", "folderId": "f", "name": 1 }),
        ),
        (
            "rename_workspace",
            json!({ "workspaceId": "x", "name": [] }),
        ),
        (
            "create_workspace_directory",
            json!({ "workspaceId": 1, "path": "x" }),
        ),
        (
            "move_workspace_file",
            json!({ "workspaceId": "x", "from": 1, "to": "y" }),
        ),
        (
            "delete_workspace_file",
            json!({ "workspaceId": "x", "path": false }),
        ),
        ("read_temp_note", json!({ "id": 1 })),
        ("write_temp_note", json!({ "id": "note", "content": 2 })),
        ("delete_temp_note", json!({ "id": [] })),
        (
            "save_temp_note_as",
            json!({ "id": "note", "suggestedName": 3 }),
        ),
        (
            "resolve_claude_session",
            json!({ "profileDir": 1, "cwd": "/x" }),
        ),
        ("resolve_agent_model", json!({ "agent": 1 })),
        (
            "export_claude_transcript",
            json!({ "profileDir": "/x", "sessionId": 1 }),
        ),
        ("agent_sessions_save", json!({})),
        ("agent_session_files_delete", json!({ "ids": "all" })),
        ("agent_quota_fetch_usage", json!({})),
        ("agent_quota_wake", json!({})),
        (
            "save_temp_image",
            json!({ "bytes": "png", "sessionId": null }),
        ),
        ("import_clipboard_files", json!({ "sessionId": 1 })),
        ("list_attachments", json!({ "sessionId": 1 })),
        ("clear_attachments", json!({ "sessionId": [] })),
        ("save_theme", json!({})),
    ];

    for (command, body) in malformed {
        let error = fixture
            .invoke(command, body.clone())
            .expect_err("a mistyped argument must be refused");
        assert!(
            error
                .as_str()
                .is_some_and(|text| text.contains("invalid") || text.contains("missing")),
            "{command} {body}: {error}"
        );
    }

    // Nothing above was allowed to write: no note, no session store, no attachment.
    assert!(!fixture.app_data_dir.join("_temp").join("note").exists());
    assert!(!fixture.app_data_dir.join("agent-sessions.json").exists());
}
