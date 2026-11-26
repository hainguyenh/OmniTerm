use super::*;
use std::sync::atomic::AtomicBool;

static NOT_CANCELLED: AtomicBool = AtomicBool::new(false);

fn silent() -> Progress<'static> {
    Progress {
        on_step: &|_| {},
        cancel: &NOT_CANCELLED,
    }
}

fn write(path: &Path, bytes: usize) {
    fs::create_dir_all(path.parent().expect("a parent folder")).expect("create parent");
    fs::write(path, vec![b'x'; bytes]).expect("write file");
}

/// A Cargo project at `dir` with a build folder holding `debug` output and an incremental cache.
fn project(dir: &Path) {
    write(&dir.join("Cargo.toml"), 10);
    write(&dir.join("target/CACHEDIR.TAG"), 5);
    write(&dir.join("target/debug/app.exe"), 100);
    write(
        &dir.join("target/debug/incremental/app-1/s-1/query.bin"),
        40,
    );
}

#[test]
fn finds_projects_with_a_cargo_build_folder_only() {
    let root = tempfile::tempdir().expect("temp root");
    project(&root.path().join("alpha"));
    project(&root.path().join("nested/deep/beta"));
    // A workspace member: a manifest without its own build folder.
    write(&root.path().join("alpha/crates/member/Cargo.toml"), 10);
    // A `target` folder Cargo did not make is not a build folder.
    write(&root.path().join("gamma/Cargo.toml"), 10);
    write(&root.path().join("gamma/target/notes.txt"), 10);
    // Projects inside dependencies or another build folder are not searched.
    project(&root.path().join("web/node_modules/pkg"));
    project(&root.path().join("alpha/target/package/inner"));

    let mut found = find_projects(&[root.path().to_path_buf()], &silent());
    found.sort();
    assert_eq!(
        found,
        vec![
            root.path().join("alpha"),
            root.path().join("nested/deep/beta")
        ]
    );
}

#[test]
fn a_root_listed_twice_reports_its_projects_once() {
    let root = tempfile::tempdir().expect("temp root");
    project(&root.path().join("alpha"));
    let roots = [root.path().to_path_buf(), root.path().to_path_buf()];
    assert_eq!(find_projects(&roots, &silent()).len(), 1);
}

#[test]
fn measures_the_build_folder_and_its_incremental_cache() {
    let root = tempfile::tempdir().expect("temp root");
    let dir = root.path().join("alpha");
    project(&dir);
    // A cross build keeps its cache one level deeper.
    write(
        &dir.join("target/x86_64-pc-windows-msvc/release/incremental/a/b.bin"),
        60,
    );

    let measured = measure_with(vec![dir.clone()], &silent());
    assert_eq!(measured.len(), 1);
    let target = &measured[0];
    assert_eq!(target.name, "alpha");
    assert_eq!(target.files, 4);
    assert_eq!(target.bytes, 205);
    assert_eq!(target.incremental_bytes, 100);
    assert!(target.last_build > 0);
}

#[test]
fn incremental_clean_keeps_the_build_output() {
    let root = tempfile::tempdir().expect("temp root");
    let dir = root.path().join("alpha");
    project(&dir);

    let results = clean_with(
        vec![dir.join("target")],
        RustCleanMode::Incremental,
        &silent(),
    );
    assert_eq!(results[0].freed_bytes, 40);
    assert_eq!(results[0].error, None);
    assert!(dir.join("target/debug/app.exe").is_file());
    assert!(!dir.join("target/debug/incremental").exists());
}

#[test]
fn full_clean_removes_the_build_folder() {
    let root = tempfile::tempdir().expect("temp root");
    let dir = root.path().join("alpha");
    project(&dir);

    let results = clean_with(vec![dir.join("target")], RustCleanMode::All, &silent());
    assert_eq!(results[0].freed_bytes, 145);
    assert!(!dir.join("target").exists());
    assert!(dir.join("Cargo.toml").is_file());
}

/// The paths come from an earlier scan: a folder that stopped being a Cargo build folder since
/// (or never was one) is never removed.
#[test]
fn refuses_a_folder_that_is_not_a_cargo_build_folder() {
    let root = tempfile::tempdir().expect("temp root");
    let precious = root.path().join("documents");
    write(&precious.join("thesis.docx"), 50);

    let results = clean_with(vec![precious.clone()], RustCleanMode::All, &silent());
    assert_eq!(results[0].freed_bytes, 0);
    assert!(results[0].error.is_some());
    assert!(precious.join("thesis.docx").is_file());
}
