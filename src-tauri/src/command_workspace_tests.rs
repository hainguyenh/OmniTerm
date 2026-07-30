use super::*;
use tempfile::TempDir;

#[test]
fn workspace_commands_persist_scan_page_edit_and_remove_real_files() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().unwrap();
    let project = root.path().join("sample-project");
    fs::create_dir_all(project.join("nested")).unwrap();
    write_file(project.join("run.sh"), b"echo first\n");
    write_file(project.join("notes.txt"), b"hello\n");
    write_file(project.join("nested/task.ps1"), b"Write-Output hi\n");
    write_file(project.join("nested/data.json"), br#"{"ok":true}"#);

    assert!(block_on(workspace::add_workspace(
        app.clone(),
        root.path().join("missing").to_string_lossy().into_owned(),
    ))
    .is_err());

    let added = block_on(workspace::add_workspace(
        app.clone(),
        project.to_string_lossy().into_owned(),
    ))
    .unwrap();
    let duplicate = block_on(workspace::add_workspace(
        app.clone(),
        project.to_string_lossy().into_owned(),
    ))
    .unwrap();
    assert_eq!(duplicate.id, added.id);
    assert_eq!(block_on(workspace::list_workspaces(app.clone())).unwrap().len(), 1);
    assert_eq!(workspace::find_workspace(&app, &added.id).unwrap().path, added.path);
    assert!(workspace::find_workspace(&app, "missing").is_err());

    let scripts = block_on(workspace::scan_scripts(app.clone(), added.id.clone())).unwrap();
    assert!(scripts.iter().any(|script| script.id == "run.sh"));
    assert!(scripts.iter().any(|script| script.id == "nested/task.ps1"));
    let folders = block_on(workspace::scan_workspace_folders(
        app.clone(),
        added.id.clone(),
    ))
    .unwrap();
    assert!(folders.iter().any(|folder| folder.id == "nested"));

    let first_page = block_on(workspace::scan_workspace_entries(
        app.clone(),
        added.id.clone(),
        "".to_string(),
        Some(0),
        Some(1),
    ))
    .unwrap();
    assert_eq!(first_page.entries.len(), 1);
    assert!(first_page.has_more);
    let remainder = block_on(workspace::scan_workspace_entries(
        app.clone(),
        added.id.clone(),
        "".to_string(),
        Some(1),
        Some(usize::MAX),
    ))
    .unwrap();
    assert!(!remainder.entries.is_empty());

    // These commands take the absolute path the scan handed the renderer, not the relative id — see
    // `ScannedScript::path`, and the `read_script`/`write_script` cases in tauriBridge.contract.test.ts.
    let absolute = |name: &str| project.join(name).to_string_lossy().into_owned();
    assert_eq!(
        block_on(workspace::read_script(
            app.clone(),
            added.id.clone(),
            absolute("notes.txt"),
        ))
        .unwrap(),
        "hello\n"
    );
    block_on(workspace::write_script(
        app.clone(),
        added.id.clone(),
        absolute("run.sh"),
        "echo changed\n".to_string(),
    ))
    .unwrap();
    assert_eq!(fs::read_to_string(project.join("run.sh")).unwrap(), "echo changed\n");
    assert!(block_on(workspace::write_script(
        app.clone(),
        added.id.clone(),
        absolute("notes.txt"),
        "blocked".to_string(),
    ))
    .is_err());

    // A real file, outside the workspace but inside the temp root, so this exercises the containment
    // check rather than just failing to resolve a path that is not there.
    write_file(root.path().join("outside.txt"), b"nope\n");
    assert!(block_on(workspace::read_script(
        app.clone(),
        added.id.clone(),
        root.path().join("outside.txt").to_string_lossy().into_owned(),
    ))
    .is_err());

    assert!(block_on(workspace::run_script(
        app.clone(),
        added.id.clone(),
        None,
        Some("nested".to_string()),
    ))
    .unwrap());
    block_on(workspace::remove_workspace(app.clone(), "not-there".to_string())).unwrap();
    block_on(workspace::remove_workspace(app.clone(), added.id)).unwrap();
    assert!(block_on(workspace::list_workspaces(app)).unwrap().is_empty());
}

#[test]
fn workspace_connection_commands_use_disk_fallback_without_a_plugin_provider() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().unwrap();
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();

    let host = fixture.app.state::<PluginHost>();
    assert!(block_on(workspace_connections::load_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
    ))
    .unwrap()
    .is_empty());
    block_on(workspace_connections::save_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
        vec![connection("ssh-1"), connection("ssh-2")],
    ))
    .unwrap();
    let loaded = block_on(workspace_connections::load_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
    ))
    .unwrap();
    assert_eq!(loaded.len(), 2);
    assert_eq!(
        workspace_connections::find_by_id(&app, "ssh-2")
            .expect("saved connection")
            .id,
        "ssh-2"
    );

    block_on(workspace_connections::delete_workspace_connection(
        app.clone(),
        host,
        workspace.id.clone(),
        "ssh-1".to_string(),
    ))
    .unwrap();
    let remaining = workspace_connections::read_at(root.path().to_str().unwrap()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "ssh-2");
    assert!(block_on(workspace_connections::load_workspace_connections(
        app,
        fixture.app.state::<PluginHost>(),
        "unknown".to_string(),
    ))
    .is_err());
}
