use super::*;

#[test]
fn canonical_dir_requires_an_existing_directory() {
    let temp = tempfile::tempdir().expect("temp directory");
    let directory = canonical_dir(temp.path().to_string_lossy().as_ref())
        .expect("directory should canonicalize");
    assert!(Path::new(&directory).is_dir());

    let file = temp.path().join("file.txt");
    std::fs::write(&file, "file").expect("write file");
    assert_eq!(
        canonical_dir(file.to_string_lossy().as_ref()),
        Err("That path is not a folder.".to_string())
    );
}

#[test]
fn new_folder_prefers_a_nonblank_name_then_the_path_leaf() {
    let named = new_folder("/tmp/project".to_string(), Some("Project".to_string()));
    assert_eq!(named.name, "Project");

    let from_path = new_folder("/tmp/project".to_string(), Some("  ".to_string()));
    assert_eq!(from_path.name, "project");

    let root = new_folder("/".to_string(), None);
    assert_eq!(root.name, "/");
}
