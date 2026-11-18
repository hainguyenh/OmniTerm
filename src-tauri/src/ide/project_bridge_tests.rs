use std::path::PathBuf;

use ide_core::IdeError;
use ide_workspace::workspace::Workspace;

use super::{
    all_trusted, container_dir, plan, project_folders, same_path, write_container, ProjectPlan,
};

#[test]
fn a_workspace_without_folders_closes_the_project() {
    assert_eq!(
        plan(&PathBuf::from("/data"), "w1", "Work", Vec::new()),
        ProjectPlan::Close
    );
}

#[test]
fn a_single_folder_is_the_project_itself() {
    let folder = PathBuf::from("/code/app");
    assert_eq!(
        plan(&PathBuf::from("/data"), "w1", "Work", vec![folder.clone()]),
        ProjectPlan::Folder(folder)
    );
}

#[test]
fn several_folders_open_a_container_named_after_the_workspace() {
    let folders = vec![PathBuf::from("/code/a"), PathBuf::from("/code/b")];
    let ProjectPlan::Container {
        root,
        name,
        projects,
    } = plan(&PathBuf::from("/data"), "w1", " Work\n2 ", folders.clone())
    else {
        panic!("expected a container plan");
    };
    assert_eq!(root, PathBuf::from("/data").join("w1"));
    assert_eq!(name, "Work 2");
    assert_eq!(projects, folders);
}

#[test]
fn a_blank_workspace_name_still_gives_the_container_a_name() {
    let folders = vec![PathBuf::from("/a"), PathBuf::from("/b")];
    let ProjectPlan::Container { name, .. } = plan(&PathBuf::from("/data"), "w", "  ", folders)
    else {
        panic!("expected a container plan");
    };
    assert_eq!(name, "Workspace");
}

#[test]
fn a_workspace_id_cannot_escape_the_containers_directory() {
    let containers = PathBuf::from("/data");
    assert_eq!(
        container_dir(&containers, "../../etc"),
        containers.join("______etc")
    );
    assert_eq!(container_dir(&containers, ""), containers.join("_"));
    assert_eq!(
        container_dir(&containers, "ws-1_a"),
        containers.join("ws-1_a")
    );
}

#[test]
fn the_container_file_is_created_then_rewritten_with_the_new_folders() {
    let data = tempfile::tempdir().expect("temp dir");
    let a = tempfile::tempdir().expect("folder a");
    let b = tempfile::tempdir().expect("folder b");
    let c = tempfile::tempdir().expect("folder c");
    let root = data.path().join("w1");

    write_container(&root, "Work", vec![a.path().into(), b.path().into()])
        .expect("create the container");
    let first = Workspace::load(&root).expect("readable").expect("written");
    assert_eq!(first.projects.len(), 2);

    write_container(&root, "Work", vec![a.path().into(), c.path().into()])
        .expect("update the container");
    let second = Workspace::load(&root).expect("readable").expect("written");
    let expected = dunce::canonicalize(c.path()).expect("canonical");
    assert!(
        second.projects.contains(&expected),
        "the new folder is listed: {:?}",
        second.projects
    );
    assert_eq!(second.projects.len(), 2);
}

#[test]
fn a_container_is_trusted_only_when_every_folder_is() {
    let folders = vec![PathBuf::from("/a"), PathBuf::from("/b")];
    assert!(all_trusted(&folders, |_| Ok(true)));
    assert!(!all_trusted(&folders, |path| Ok(
        path == std::path::Path::new("/a")
    )));
    // Unreadable trust state never trusts.
    assert!(!all_trusted(&folders, |_| Err(IdeError::internal(
        "unreadable"
    ))));
    assert!(!all_trusted(&[], |_| Ok(true)));
}

#[test]
fn the_same_folder_is_recognised_through_a_different_spelling() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spelled_differently = dir.path().join("sub").join("..");
    std::fs::create_dir_all(dir.path().join("sub")).expect("sub folder");
    assert!(same_path(dir.path(), &spelled_differently));
    assert!(!same_path(dir.path(), &dir.path().join("sub")));
    // Paths that do not exist are compared as written.
    assert!(same_path(
        &PathBuf::from("/no/such/a"),
        &PathBuf::from("/no/such/a")
    ));
    assert!(!same_path(
        &PathBuf::from("/no/such/a"),
        &PathBuf::from("/no/such/b")
    ));
}

#[test]
fn disabled_folders_are_left_out_of_the_project() {
    let folder = |id: &str, disabled: bool| app_protocol::workspace::WorkspaceFolder {
        id: id.to_string(),
        name: id.to_string(),
        path: format!("/work/{id}"),
        color: None,
        disabled,
    };
    let mut workspace = app_protocol::workspace::Workspace {
        id: "w".to_string(),
        name: "W".to_string(),
        folders: vec![folder("a", false), folder("b", true), folder("c", false)],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    assert_eq!(
        project_folders(&workspace),
        vec![PathBuf::from("/work/a"), PathBuf::from("/work/c")]
    );
    // One folder left is a plain folder project; none left closes the project.
    workspace.folders[2].disabled = true;
    let containers = PathBuf::from("/c");
    assert_eq!(
        plan(&containers, "w", "W", project_folders(&workspace)),
        ProjectPlan::Folder(PathBuf::from("/work/a"))
    );
    workspace.folders[0].disabled = true;
    assert_eq!(
        plan(&containers, "w", "W", project_folders(&workspace)),
        ProjectPlan::Close
    );
}
