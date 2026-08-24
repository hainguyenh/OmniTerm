//! Provider data drives global workspace and resolution fallback behavior. 
use super::*;
use super::integration_tests::{block_on, connection, setup, start_provider};
use crate::connections::ConnectionTree;
use crate::{connections, pty_resolve, workspace, workspace_connections};
#[test]
fn provider_data_drives_global_workspace_and_resolution_fallbacks() {
    let _guard = crate::test_support::lock();
    let (app, workspace_root, paths) = setup();
    let handle = app.handle().clone();
    let workspace = block_on(workspace::add_workspace(
        handle.clone(),
        workspace_root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();
    let host = app.state::<PluginHost>();
    start_provider(host.inner(), paths, false);

    let global = block_on(connections::load_connections(handle.clone(), host.clone())).unwrap();
    assert_eq!(global.connections[0].id, "remote-global");
    block_on(connections::save_connections(
        handle.clone(),
        host.clone(),
        ConnectionTree {
            connections: vec![connection("saved")],
            folders: vec![],
        },
    ))
    .unwrap();
    assert!(!connections::connections_path(&handle).unwrap().exists());

    let scoped = block_on(workspace_connections::load_workspace_connections(
        handle.clone(),
        host.clone(),
        workspace.id.clone(),
    ))
    .unwrap();
    assert_eq!(scoped.len(), 2);
    block_on(workspace_connections::save_workspace_connections(
        handle.clone(),
        host.clone(),
        workspace.id.clone(),
        vec![connection("saved-scoped")],
    ))
    .unwrap();
    block_on(workspace_connections::delete_workspace_connection(
        handle.clone(),
        host.clone(),
        workspace.id,
        "remove-me".into(),
    ))
    .unwrap();
    assert!(!workspace_root
        .path()
        .join(".omniterm/connections.json")
        .exists());

    assert_eq!(
        block_on(pty_resolve::resolve_connection_by_id(
            &handle,
            "scoped-provider"
        ))
        .unwrap()
        .id,
        "scoped-provider"
    );
    assert_eq!(
        block_on(pty_resolve::resolve_connection_by_id(
            &handle,
            "personal-provider"
        ))
        .unwrap()
        .id,
        "personal-provider"
    );
}

