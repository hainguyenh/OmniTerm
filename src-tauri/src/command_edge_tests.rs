use super::*;
use serde_json::json;
use tempfile::TempDir;
use tauri::Manager;

#[test]
fn workspace_commands_reject_deleted_roots_and_oversized_connection_files() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().unwrap();
    let project = root.path().join("project");
    fs::create_dir_all(&project).unwrap();
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        project.to_string_lossy().into_owned(),
    ))
    .unwrap();

    fs::remove_dir_all(&project).unwrap();
    assert_eq!(
        block_on(workspace::scan_scripts(app.clone(), workspace.id.clone())).unwrap_err(),
        "Workspace path is invalid"
    );
    assert_eq!(
        block_on(workspace::scan_workspace_folders(
            app.clone(),
            workspace.id.clone(),
        ))
        .unwrap_err(),
        "Workspace path is invalid"
    );
    assert_eq!(
        block_on(workspace::scan_workspace_entries(
            app.clone(),
            workspace.id.clone(),
            String::new(),
            None,
            None,
        ))
        .unwrap_err(),
        "Workspace path is invalid"
    );

    fs::create_dir_all(&project).unwrap();
    let oversized = (0..20_000)
        .map(|index| connection(&format!("connection-{index}")))
        .collect::<Vec<_>>();
    let host = fixture.app.state::<PluginHost>();
    let error = block_on(workspace_connections::save_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
        oversized,
    ))
    .unwrap_err();
    assert!(error.contains("too large"), "{error}");
    assert!(!project.join(".omniterm").exists());

    block_on(workspace_connections::delete_workspace_connection(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
        "not-present".to_string(),
    ))
    .unwrap();
    assert!(!project.join(".omniterm").exists());

    let blocked_file = project.join(".omniterm/connections.json");
    fs::create_dir_all(&blocked_file).unwrap();
    assert!(block_on(workspace_connections::load_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
    ))
    .is_err());
    assert!(block_on(workspace_connections::save_workspace_connections(
        app.clone(),
        host.clone(),
        workspace.id.clone(),
        vec![connection("small")],
    ))
    .is_err());
    assert!(block_on(workspace_connections::delete_workspace_connection(
        app,
        host,
        workspace.id,
        "small".to_string(),
    ))
    .is_err());
}

#[test]
fn persistence_commands_surface_directory_and_write_failures() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    let settings_path = fixture.data_dir.join("settings.json");
    fs::create_dir_all(&settings_path).unwrap();
    let settings_error = block_on(settings::save_settings(
        app.clone(),
        json!({ "fontSize": 17 }),
    ))
    .unwrap_err();
    assert!(settings_error.contains("Failed to write settings file"));
    assert_eq!(settings::read_settings(&app)["fontSize"], json!(14));
    fs::remove_dir_all(&settings_path).unwrap();

    let connections_path = connections::connections_path(&app).unwrap();
    fs::create_dir_all(&connections_path).unwrap();
    assert!(connections::read_tree(&app).is_err());
    let save_error = block_on(connections::save_connections(
        app.clone(),
        fixture.app.state::<PluginHost>(),
        connections::ConnectionTree::default(),
    ))
    .unwrap_err();
    assert!(!save_error.is_empty());
    fs::remove_dir_all(&connections_path).unwrap();

    let workspaces_path = fixture.data_dir.join("workspaces.json");
    fs::create_dir_all(&workspaces_path).unwrap();
    assert!(block_on(workspace::list_workspaces(app.clone())).is_err());
    let project = TempDir::new().unwrap();
    assert!(block_on(workspace::add_workspace(
        app.clone(),
        project.path().to_string_lossy().into_owned(),
    ))
    .is_err());
    assert!(block_on(workspace::remove_workspace(app, "missing".to_string())).is_err());
}

#[test]
fn workspace_settings_change_file_limits_and_user_exclusions_immediately() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("visible.txt"), "visible").unwrap();
    fs::write(root.path().join("hidden.pem"), "private metadata").unwrap();
    fs::write(root.path().join("large.txt"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();

    block_on(settings::save_settings(
        app.clone(),
        json!({
            "maxOpenFileMb": 1,
            "excludedViewableExts": ["PEM", 42, "txt"]
        }),
    ))
    .unwrap();
    assert!(block_on(workspace::read_script(
        app.clone(),
        workspace.id.clone(),
        root.path().join("visible.txt").to_string_lossy().into_owned(),
    ))
    .unwrap_err()
    .contains("cannot be viewed"));
    assert!(block_on(workspace::read_script(
        app.clone(),
        workspace.id.clone(),
        root.path().join("hidden.pem").to_string_lossy().into_owned(),
    ))
    .unwrap_err()
    .contains("cannot be viewed"));

    block_on(settings::save_settings(
        app.clone(),
        json!({ "excludedViewableExts": [], "maxOpenFileMb": 1 }),
    ))
    .unwrap();
    assert_eq!(
        block_on(workspace::read_script(
            app.clone(),
            workspace.id.clone(),
            root.path().join("visible.txt").to_string_lossy().into_owned(),
        ))
        .unwrap(),
        "visible"
    );
    assert!(block_on(workspace::read_script(
        app,
        workspace.id,
        root.path().join("large.txt").to_string_lossy().into_owned(),
    ))
    .unwrap_err()
    .contains("viewer limit"));
}
