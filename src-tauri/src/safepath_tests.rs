//! Tests for `safepath`: the workspace containment gates, and the viewer/editor read and write paths.
//!
//! Split out of safepath.rs to keep both files inside the per-file line limit
//! (src/__tests__/code-write.lines.test.ts), matching this crate's `#[path = "*_tests.rs"]` layout.

use super::*;
use std::fs::File;
use std::io::Write as _;

/// A workspace root with `deploy.bat`, `notes.txt`, `sub/` and a sibling `outside/secret.bat`
/// that the workspace must never reach.
struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    outside: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-safepath")
        .tempdir()
        .expect("temp dir");
    let base = dunce::canonicalize(dir.path()).expect("canonical base");
    let root = base.join("workspace");
    let outside = base.join("outside");
    fs::create_dir_all(root.join("sub")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    File::create(root.join("deploy.bat"))
        .unwrap()
        .write_all(b"echo hi")
        .unwrap();
    File::create(root.join("notes.txt")).unwrap();
    File::create(root.join("host.rdp")).unwrap();
    File::create(outside.join("secret.bat"))
        .unwrap()
        .write_all(b"secret")
        .unwrap();
    Fixture {
        _dir: dir,
        root,
        outside,
    }
}

fn root_str(f: &Fixture) -> String {
    f.root.to_string_lossy().into_owned()
}

#[test]
fn accepts_an_editable_script_inside_the_workspace() {
    let f = fixture();
    let path = f.root.join("deploy.bat");
    let resolved =
        safe_editable_path(&root_str(&f), &path.to_string_lossy()).expect("should accept");
    assert_eq!(resolved, dunce::canonicalize(&path).unwrap());
}

/// The resolved path is spliced into a `cmd /c` command line by `workspace::run_script`, so a
/// `\\?\` verbatim prefix here surfaced to the user as "is not recognized as an internal or
/// external command". Guard both the run and the subdir (pane cwd) paths.
#[test]
fn resolved_paths_carry_no_verbatim_prefix() {
    let f = fixture();
    let script = f.root.join("deploy.bat");
    for resolved in [
        safe_runnable_path(&root_str(&f), &script.to_string_lossy()).unwrap(),
        safe_subdir(&root_str(&f), "sub", false).unwrap(),
    ] {
        assert!(
            !resolved.to_string_lossy().starts_with(r"\\?\"),
            "got a verbatim path: {}",
            resolved.display()
        );
    }
}

/// The core regression: `read_script`/`write_script` took a raw path and ignored the workspace,
/// so the webview could read or overwrite any file on disk.
#[test]
fn rejects_a_script_outside_the_workspace() {
    let f = fixture();
    let escape = f.outside.join("secret.bat");
    let err = safe_editable_path(&root_str(&f), &escape.to_string_lossy())
        .expect_err("must reject a path outside the workspace");
    assert!(err.contains("outside its workspace"), "got {err}");
}

#[test]
fn rejects_traversal_back_out_of_the_workspace() {
    let f = fixture();
    let traversal = f.root.join("..").join("outside").join("secret.bat");
    let err = safe_editable_path(&root_str(&f), &traversal.to_string_lossy())
        .expect_err("must reject traversal");
    assert!(err.contains("outside its workspace"), "got {err}");
}

#[test]
fn rejects_the_workspace_root_itself() {
    let f = fixture();
    assert!(safe_editable_path(&root_str(&f), &root_str(&f)).is_err());
}

#[test]
fn rejects_non_editable_extensions() {
    let f = fixture();
    for name in ["notes.txt", "host.rdp"] {
        let path = f.root.join(name);
        let err = safe_editable_path(&root_str(&f), &path.to_string_lossy())
            .expect_err("must reject a non-editable extension");
        assert!(err.contains("only executable scripts"), "{name}: got {err}");
    }
}

#[test]
fn extension_check_is_case_insensitive() {
    let f = fixture();
    let upper = f.root.join("Deploy.BAT");
    File::create(&upper).unwrap();
    assert!(safe_editable_path(&root_str(&f), &upper.to_string_lossy()).is_ok());
}

// Read and write at the default cap — what every caller but the settings path uses.
fn read(f: &Fixture, path: &Path) -> Result<String, String> {
    read_viewable(&root_str(f), &path.to_string_lossy(), DEFAULT_MAX_VIEW_BYTES)
}

fn write(f: &Fixture, path: &Path, content: &str) -> Result<(), String> {
    write_editable(&root_str(f), &path.to_string_lossy(), content, DEFAULT_MAX_VIEW_BYTES)
}

#[test]
fn read_and_write_round_trip_inside_the_workspace() {
    let f = fixture();
    let path = f.root.join("deploy.bat");
    assert_eq!(read(&f, &path).unwrap(), "echo hi");
    write(&f, &path, "echo bye").unwrap();
    assert_eq!(read(&f, &path).unwrap(), "echo bye");
}

#[test]
fn write_refuses_to_touch_a_file_outside_the_workspace() {
    let f = fixture();
    let escape = f.outside.join("secret.bat");
    assert!(write(&f, &escape, "pwned").is_err());
    // The file must be byte-for-byte untouched, not merely "the call returned Err".
    assert_eq!(fs::read_to_string(&escape).unwrap(), "secret");
}

#[test]
fn write_rejects_oversized_content_before_resolving_the_path() {
    let f = fixture();
    let path = f.root.join("deploy.bat");
    let huge = "x".repeat(DEFAULT_MAX_VIEW_BYTES as usize + 1);
    assert!(write(&f, &path, &huge).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "echo hi");
}

include!("safepath_view_tests.rs");

/// `.rdp` is launchable but not editable — the two allowlists must stay distinct.
#[test]
fn rdp_is_runnable_but_not_editable() {
    let f = fixture();
    let rdp = f.root.join("host.rdp");
    let p = rdp.to_string_lossy().into_owned();
    assert!(safe_runnable_path(&root_str(&f), &p).is_ok());
    assert!(safe_editable_path(&root_str(&f), &p).is_err());
}

#[test]
fn run_refuses_a_script_outside_the_workspace() {
    let f = fixture();
    let escape = f.outside.join("secret.bat");
    assert!(safe_runnable_path(&root_str(&f), &escape.to_string_lossy()).is_err());
}

#[test]
fn run_refuses_an_arbitrary_executable_inside_the_workspace() {
    let f = fixture();
    let exe = f.root.join("payload.exe");
    File::create(&exe).unwrap();
    let err = safe_runnable_path(&root_str(&f), &exe.to_string_lossy())
        .expect_err("must reject a non-script extension");
    assert!(err.contains("only scanned scripts"), "got {err}");
}

#[test]
fn accepts_a_subdirectory_of_the_workspace() {
    let f = fixture();
    let resolved = safe_subdir(&root_str(&f), "sub", false).expect("should accept");
    assert_eq!(resolved, dunce::canonicalize(f.root.join("sub")).unwrap());
}

#[test]
fn rejects_subdir_traversal_and_absolute_paths() {
    let f = fixture();
    let absolute = f.outside.to_string_lossy().into_owned();
    for hostile in ["../outside", "sub/../../outside", &absolute] {
        let err = safe_subdir(&root_str(&f), hostile, false)
            .expect_err("must reject escaping subPath");
        assert!(err.contains("outside its workspace"), "{hostile}: got {err}");
    }
}

#[test]
fn rejects_a_subdir_that_is_a_file() {
    let f = fixture();
    let err = safe_subdir(&root_str(&f), "deploy.bat", false).expect_err("must reject a file");
    assert!(err.contains("not a directory"), "got {err}");
}
