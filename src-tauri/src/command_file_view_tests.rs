//! The editor's image and Git-context commands, driven through the mock runtime: logical path
//! resolution, the settings-backed exclusions, and the "not a repository" refusal.

use super::*;
use crate::file_view_commands::{git_file_context, open_image_file};
use serde_json::json;
use std::process::Command;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new(app_core::git::resolve_git_binary())
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn open_image_file_reads_images_and_honours_exclusions() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    write_file(root.path().join("img/logo.png"), b"\x89PNG\r\n\x1a\n");
    write_file(root.path().join("notes.txt"), b"text");
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let folder = workspace.folders[0].id.clone();

    assert!(block_on(open_image_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/img/logo.png"),
    ))
    .is_ok());
    let text = block_on(open_image_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/notes.txt"),
    ));
    assert!(text.is_err_and(|error| error.contains("cannot be shown as an image")));
    assert!(block_on(open_image_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/../outside.png"),
    ))
    .is_err());

    block_on(settings::save_settings(
        app.clone(),
        json!({ "excludedViewableExts": ["png"] }),
    ))
    .expect("save settings");
    assert!(block_on(open_image_file(
        app,
        workspace.id,
        format!("{folder}/img/logo.png"),
    ))
    .is_err());
}

#[test]
fn git_file_context_maps_workspace_paths_into_the_repository() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    let repo = dunce::canonicalize(root.path())
        .expect("canonical root")
        .join("repo");
    write_file(repo.join("src/app.ts"), b"let a = 1\n");
    git(&repo, &["init", "-q", "-b", "main"]);
    // The workspace pins a subfolder, so the logical path and the repo path differ by `src/`.
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        repo.join("src").to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let folder = workspace.folders[0].id.clone();

    let context = block_on(git_file_context(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/app.ts"),
    ))
    .expect("context");
    assert_eq!(PathBuf::from(&context.repo_root), repo);
    assert_eq!(context.relative_path, "src/app.ts");

    assert!(block_on(git_file_context(
        app,
        workspace.id,
        format!("{folder}/missing.ts"),
    ))
    .is_err());
}

#[test]
fn git_file_context_refuses_files_outside_a_repository() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    write_file(root.path().join("loose.txt"), b"x");
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let folder = workspace.folders[0].id.clone();

    assert!(block_on(git_file_context(
        app,
        workspace.id,
        format!("{folder}/loose.txt"),
    ))
    .is_err());
}
