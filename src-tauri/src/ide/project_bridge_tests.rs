use std::path::PathBuf;

use ide_core::IdeError;
use ide_workspace::workspace::Workspace;

use super::{all_trusted, container_dir, plan, write_container, ProjectPlan};

#[test]
fn a_workspace_without_folders_closes_the_project() {
    assert_eq!(plan(&PathBuf::from("/data"), "w1", "Work", Vec::new()), ProjectPlan::Close);
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
    let ProjectPlan::Container { root, name, projects } = plan(&PathBuf::from("/data"), "w1", " Work\n2 ", folders.clone())
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
    let ProjectPlan::Container { name, .. } = plan(&PathBuf::from("/data"), "w", "  ", folders) else {
        panic!("expected a container plan");
    };
    assert_eq!(name, "Workspace");
}

#[test]
fn a_workspace_id_cannot_escape_the_containers_directory() {
    let containers = PathBuf::from("/data");
    assert_eq!(container_dir(&containers, "../../etc"), containers.join("______etc"));
    assert_eq!(container_dir(&containers, ""), containers.join("_"));
    assert_eq!(container_dir(&containers, "ws-1_a"), containers.join("ws-1_a"));
}

#[test]
fn the_container_file_is_created_then_rewritten_with_the_new_folders() {
    let data = tempfile::tempdir().expect("temp dir");
    let a = tempfile::tempdir().expect("folder a");
    let b = tempfile::tempdir().expect("folder b");
    let c = tempfile::tempdir().expect("folder c");
    let root = data.path().join("w1");

    write_container(&root, "Work", vec![a.path().into(), b.path().into()]).expect("create the container");
    let first = Workspace::load(&root).expect("readable").expect("written");
    assert_eq!(first.projects.len(), 2);

    write_container(&root, "Work", vec![a.path().into(), c.path().into()]).expect("update the container");
    let second = Workspace::load(&root).expect("readable").expect("written");
    let expected = dunce::canonicalize(c.path()).expect("canonical");
    assert!(second.projects.contains(&expected), "the new folder is listed: {:?}", second.projects);
    assert_eq!(second.projects.len(), 2);
}

#[test]
fn a_container_is_trusted_only_when_every_folder_is() {
    let folders = vec![PathBuf::from("/a"), PathBuf::from("/b")];
    assert!(all_trusted(&folders, |_| Ok(true)));
    assert!(!all_trusted(&folders, |path| Ok(path == std::path::Path::new("/a"))));
    // Unreadable trust state never trusts.
    assert!(!all_trusted(&folders, |_| Err(IdeError::internal("unreadable"))));
    assert!(!all_trusted(&[], |_| Ok(true)));
}
