use super::*;
use std::fs;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    outside: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-idepaths")
        .tempdir()
        .expect("temp dir");
    let base = dunce::canonicalize(dir.path()).expect("canonical base");
    let root = base.join("project");
    let outside = base.join("outside");
    fs::create_dir_all(root.join("src")).expect("project dir");
    fs::create_dir_all(&outside).expect("outside dir");
    fs::write(root.join("src").join("main.rs"), "fn main() {}").expect("file");
    fs::write(outside.join("secret.txt"), "secret").expect("secret");
    Fixture {
        _dir: dir,
        root,
        outside,
    }
}

#[test]
fn an_existing_path_inside_a_root_resolves() {
    let fx = fixture();
    let path = fx.root.join("src").join("main.rs");
    assert_eq!(
        resolve_in_roots(std::slice::from_ref(&fx.root), &path, Access::Existing).expect("inside"),
        path
    );
}

#[test]
fn the_root_itself_is_allowed() {
    let fx = fixture();
    assert!(resolve_in_roots(std::slice::from_ref(&fx.root), &fx.root, Access::Existing).is_ok());
}

#[test]
fn a_path_outside_every_root_is_refused() {
    let fx = fixture();
    let error = resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &fx.outside.join("secret.txt"),
        Access::Existing,
    )
    .expect_err("outside");
    assert!(error.contains("outside"), "unexpected message: {error}");
}

#[test]
fn dot_dot_cannot_climb_out_of_a_root() {
    let fx = fixture();
    let sneaky = fx
        .root
        .join("src")
        .join("..")
        .join("..")
        .join("outside")
        .join("secret.txt");
    assert!(resolve_in_roots(std::slice::from_ref(&fx.root), &sneaky, Access::Existing).is_err());
}

#[test]
fn a_sibling_folder_sharing_the_root_prefix_is_not_inside() {
    let fx = fixture();
    let sibling = fx.root.parent().expect("base").join("project-evil");
    fs::create_dir_all(&sibling).expect("sibling");
    assert!(resolve_in_roots(std::slice::from_ref(&fx.root), &sibling, Access::Existing).is_err());
}

#[test]
fn any_of_several_roots_may_contain_the_path() {
    let fx = fixture();
    let roots = vec![fx.root.clone(), fx.outside.clone()];
    assert!(resolve_in_roots(&roots, &fx.outside.join("secret.txt"), Access::Existing).is_ok());
}

#[test]
fn no_roots_means_nothing_is_reachable() {
    let fx = fixture();
    let error = resolve_in_roots(&[], &fx.root, Access::Existing).expect_err("no roots");
    assert!(
        error.contains("no workspace folder"),
        "unexpected message: {error}"
    );
    let missing = vec![fx.root.join("gone")];
    assert!(resolve_in_roots(&missing, &fx.root, Access::Existing).is_err());
}

#[test]
fn a_new_path_resolves_through_its_parent() {
    let fx = fixture();
    let path = fx.root.join("src").join("new.rs");
    let resolved =
        resolve_in_roots(std::slice::from_ref(&fx.root), &path, Access::New).expect("new file");
    assert_eq!(resolved, path);
}

#[test]
fn a_new_path_in_a_missing_or_outside_parent_is_refused() {
    let fx = fixture();
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &fx.root.join("nope").join("a.rs"),
        Access::New
    )
    .is_err());
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &fx.outside.join("a.rs"),
        Access::New
    )
    .is_err());
}

#[test]
fn a_new_path_ending_in_dot_dot_or_without_a_name_is_refused() {
    let fx = fixture();
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &fx.root.join(".."),
        Access::New
    )
    .is_err());
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        Path::new("relative-only"),
        Access::New
    )
    .is_err());
}

#[test]
fn an_archive_entry_is_checked_through_its_archive_file() {
    let fx = fixture();
    let archive = fx.root.join("lib.zip");
    fs::write(&archive, b"zip").expect("archive");
    let entry = PathBuf::from(format!("{}!/dir/a.txt", archive.display()));
    let resolved =
        resolve_in_roots(std::slice::from_ref(&fx.root), &entry, Access::Existing).expect("entry");
    assert!(resolved.to_string_lossy().ends_with("lib.zip!/dir/a.txt"));

    let foreign = fx.outside.join("x.zip");
    fs::write(&foreign, b"zip").expect("foreign archive");
    let foreign_entry = PathBuf::from(format!("{}!/a.txt", foreign.display()));
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &foreign_entry,
        Access::Existing
    )
    .is_err());
}

#[test]
fn an_archive_separator_cannot_smuggle_dot_dot_out_of_a_root() {
    let fx = fixture();
    let roots = std::slice::from_ref(&fx.root);
    // `src` is a directory, not an archive: `src!/..` must not be trusted as an archive entry.
    let sneaky = PathBuf::from(format!("{}!/../../outside", fx.root.join("src").display()));
    assert!(resolve_in_roots(roots, &sneaky, Access::Existing).is_err());
    assert!(resolve_in_roots(roots, &sneaky, Access::New).is_err());

    // Even for a real archive, an entry may not climb.
    let archive = fx.root.join("lib.zip");
    fs::write(&archive, b"zip").expect("archive");
    let climbing = PathBuf::from(format!("{}!/../../x", archive.display()));
    assert!(resolve_in_roots(roots, &climbing, Access::Existing).is_err());
}

#[cfg(unix)]
#[test]
fn a_symlink_inside_a_root_cannot_lead_outside_it() {
    let fx = fixture();
    let link = fx.root.join("link");
    std::os::unix::fs::symlink(&fx.outside, &link).expect("symlink");
    assert!(resolve_in_roots(
        std::slice::from_ref(&fx.root),
        &link.join("secret.txt"),
        Access::Existing
    )
    .is_err());
}

#[test]
fn key_material_is_recognised_case_insensitively_and_stays_in_the_viewer_deny_list() {
    assert!(is_key_material(Path::new("/p/id.PEM")));
    assert!(is_key_material(Path::new("C:/p/server.key")));
    assert!(!is_key_material(Path::new("/p/main.rs")));
    assert!(!is_key_material(Path::new("/p/key")));
    for extension in KEY_MATERIAL_EXTS {
        assert!(
            crate::safepath::VIEW_DENY_EXTS.contains(extension),
            "{extension} is not refused by the viewer"
        );
    }
}
