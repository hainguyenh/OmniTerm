//! The editor's open/save commands, driven through the mock runtime: logical path resolution, the
//! settings-backed cap and exclusions, and the conflict round trip.

use super::*;
use crate::text_file_commands::{open_text_file, save_text_file};
use app_protocol::text_file::{TextFileSaveOutcome, TextFileSaveRequest};
use serde_json::json;
use tempfile::TempDir;

fn request(content: &str, mtime: u64, size: u64) -> TextFileSaveRequest {
    TextFileSaveRequest {
        content: content.to_string(),
        bom: false,
        expected_mtime_ms: Some(mtime),
        expected_size: Some(size),
        force: false,
    }
}

#[test]
fn text_file_commands_open_save_and_report_conflicts() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    let project = root.path().join("project");
    write_file(project.join("src/app.ts"), b"let a = 1\r\n");
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        project.to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let logical = format!("{}/src/app.ts", workspace.folders[0].id);

    let opened = block_on(open_text_file(
        app.clone(),
        workspace.id.clone(),
        logical.clone(),
    ))
    .expect("open ts file");
    assert_eq!(opened.content, "let a = 1\r\n");
    assert_eq!(opened.line_count, 2);

    let outcome = block_on(save_text_file(
        app.clone(),
        workspace.id.clone(),
        logical.clone(),
        request("let a = 2\r\n", opened.mtime_ms, opened.size),
    ))
    .expect("save ts file");
    assert!(matches!(
        outcome,
        TextFileSaveOutcome::Saved { size: 11, .. }
    ));
    assert_eq!(
        fs::read(project.join("src/app.ts")).expect("read saved"),
        b"let a = 2\r\n"
    );

    // The editor still holds the first version, so a second save from it must not clobber the disk.
    let stale = block_on(save_text_file(
        app.clone(),
        workspace.id.clone(),
        logical,
        request("let a = 3\r\n", opened.mtime_ms, opened.size - 1),
    ))
    .expect("stale save attempt");
    assert!(matches!(stale, TextFileSaveOutcome::Conflict { .. }));

    assert!(block_on(open_text_file(
        app.clone(),
        "missing".to_string(),
        "x/y.txt".to_string()
    ))
    .is_err());
    assert!(block_on(save_text_file(
        app,
        workspace.id,
        format!("{}/../outside.txt", workspace.folders[0].id),
        request("x", 0, 0),
    ))
    .is_err());
}

#[test]
fn text_file_commands_apply_the_configured_cap_and_exclusions() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    write_file(root.path().join("notes.md"), b"# notes");
    write_file(root.path().join("large.log"), vec![b'x'; 1024 * 1024 + 1]);
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let folder = workspace.folders[0].id.clone();

    block_on(settings::save_settings(
        app.clone(),
        json!({ "maxOpenFileMb": 1, "excludedViewableExts": ["md"] }),
    ))
    .expect("save settings");
    let excluded = block_on(open_text_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/notes.md"),
    ))
    .expect_err("excluded kind");
    assert!(excluded.contains("cannot be viewed"));
    let large = block_on(open_text_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/large.log"),
    ))
    .expect_err("over the cap");
    assert!(large.contains("Max file size to open"));
    let blocked = block_on(save_text_file(
        app,
        workspace.id,
        format!("{folder}/notes.md"),
        request("x", 0, 0),
    ))
    .expect_err("excluded kinds cannot be saved either");
    assert!(blocked.contains("cannot be viewed"));
}
