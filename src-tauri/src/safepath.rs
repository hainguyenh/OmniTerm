//! Workspace path containment.
//!
//! Ports Electron's `safeEditablePath` / `safeSubdir` (electron/core/workspaceHost.ts). The renderer
//! only ever hands back paths we handed it from a scan, but the backend re-validates so a
//! crafted/compromised webview request cannot read or write files outside the workspace the user
//! actually pinned. Symlinks are resolved before the containment check so a link planted inside the
//! workspace cannot point out of it.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// Extensions the built-in provider will read/write as text. Everything else is launch-only —
/// notably `.rdp`, which is scanned and launchable but never editable.
pub const EDITABLE_EXTS: [&str; 4] = ["bat", "cmd", "ps1", "sh"];

/// Max bytes the built-in editor will load or save. Scripts are small; this stops a giant-file read
/// from being turned into a memory-exhaustion lever.
pub const MAX_SCRIPT_BYTES: u64 = 1024 * 1024;

/// Resolve symlinks and `..` into an absolute path, *without* Windows' `\\?\` verbatim prefix.
///
/// `dunce::canonicalize` is `fs::canonicalize` minus that prefix. The distinction matters because
/// these paths do not stay inside Rust: they are embedded in `cmd /c "<path>"` command lines and used
/// as a pane's working directory, and `cmd.exe` understands neither form of verbatim path — it read
/// `\\?\D:\ws\stop.bat` as a literal relative name and answered "is not recognized as an internal or
/// external command". `dunce` keeps the prefix only when the path genuinely needs it (>260 chars, or a
/// name cmd could not address anyway), so containment comparisons stay exact.
fn canonical(path: &Path) -> Result<PathBuf, String> {
    dunce::canonicalize(path).map_err(|e| format!("cannot resolve {}: {}", path.display(), e))
}

/// True if `candidate` is a strict descendant of `root`. Both must already be canonicalized.
fn is_inside(root: &Path, candidate: &Path) -> bool {
    candidate != root && candidate.starts_with(root)
}

/// Extensions the scanner surfaces as launchable. `.rdp` is launch-only — handed to the OS Remote
/// Desktop client rather than run as a script.
pub const LAUNCHABLE_EXTS: [&str; 5] = ["bat", "cmd", "ps1", "sh", "rdp"];

fn contained(
    root: &str,
    script_path: &str,
    allowed_exts: &[&str],
    ext_error: &str,
) -> Result<PathBuf, String> {
    let real_root = canonical(Path::new(root))?;
    let real = canonical(Path::new(script_path))?;

    if !is_inside(&real_root, &real) {
        return Err("script is outside its workspace".to_string());
    }

    let ext = real
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !allowed_exts.contains(&ext.as_str()) {
        return Err(ext_error.to_string());
    }

    Ok(real)
}

/// Resolve `script_path` and assert it lives inside `root` with an editable extension.
///
/// Returns the canonical path on success. Errors — rather than falling back to the raw path — on
/// anything outside the workspace, so a caller that ignores the Result cannot still touch the file.
pub fn safe_editable_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    contained(
        root,
        script_path,
        &EDITABLE_EXTS,
        "only executable scripts can be edited",
    )
}

/// Same containment check for a script we are about to *run*.
///
/// Electron only re-validated on the edit path. Running is the more consequential of the two, and the
/// renderer supplies `script.path` verbatim, so it is checked here too — the paths always originate
/// from our own scan, and anything else is a crafted request.
pub fn safe_runnable_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    contained(
        root,
        script_path,
        &LAUNCHABLE_EXTS,
        "only scanned scripts can be run",
    )
}

/// Resolve a relative `sub_path` under `root` and assert it stays inside the workspace and is a
/// directory. Used by "open a terminal here" on a subfolder.
pub fn safe_subdir(root: &str, sub_path: &str) -> Result<PathBuf, String> {
    let real_root = canonical(Path::new(root))?;

    // Reject absolute paths and `..` before touching the filesystem: `Path::join` silently discards
    // the root when handed an absolute path, so `join("C:\\Windows")` would escape without ever
    // looking like traversal.
    let candidate = Path::new(sub_path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
    {
        return Err("directory is outside its workspace".to_string());
    }

    let real = canonical(&real_root.join(candidate))?;
    if !real.starts_with(&real_root) {
        return Err("directory is outside its workspace".to_string());
    }
    if !real.is_dir() {
        return Err("not a directory".to_string());
    }
    Ok(real)
}

/// Read an in-workspace script as UTF-8, bounded by `MAX_SCRIPT_BYTES`.
pub fn read_editable(root: &str, script_path: &str) -> Result<String, String> {
    let real = safe_editable_path(root, script_path)?;
    let size = fs::metadata(&real).map_err(|e| e.to_string())?.len();
    if size > MAX_SCRIPT_BYTES {
        return Err("file too large to edit".to_string());
    }
    fs::read_to_string(&real).map_err(|e| e.to_string())
}

/// Write an in-workspace script, bounded by `MAX_SCRIPT_BYTES`.
pub fn write_editable(root: &str, script_path: &str, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_SCRIPT_BYTES {
        return Err("content too large to save".to_string());
    }
    let real = safe_editable_path(root, script_path)?;
    fs::write(&real, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
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
            safe_subdir(&root_str(&f), "sub").unwrap(),
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

    #[test]
    fn read_and_write_round_trip_inside_the_workspace() {
        let f = fixture();
        let path = f.root.join("deploy.bat");
        let p = path.to_string_lossy().into_owned();
        assert_eq!(read_editable(&root_str(&f), &p).unwrap(), "echo hi");
        write_editable(&root_str(&f), &p, "echo bye").unwrap();
        assert_eq!(read_editable(&root_str(&f), &p).unwrap(), "echo bye");
    }

    #[test]
    fn write_refuses_to_touch_a_file_outside_the_workspace() {
        let f = fixture();
        let escape = f.outside.join("secret.bat");
        assert!(write_editable(&root_str(&f), &escape.to_string_lossy(), "pwned").is_err());
        // The file must be byte-for-byte untouched, not merely "the call returned Err".
        assert_eq!(fs::read_to_string(&escape).unwrap(), "secret");
    }

    #[test]
    fn write_rejects_oversized_content_before_resolving_the_path() {
        let f = fixture();
        let path = f.root.join("deploy.bat");
        let huge = "x".repeat(MAX_SCRIPT_BYTES as usize + 1);
        assert!(write_editable(&root_str(&f), &path.to_string_lossy(), &huge).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "echo hi");
    }

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
        let resolved = safe_subdir(&root_str(&f), "sub").expect("should accept");
        assert_eq!(resolved, dunce::canonicalize(f.root.join("sub")).unwrap());
    }

    #[test]
    fn rejects_subdir_traversal_and_absolute_paths() {
        let f = fixture();
        let absolute = f.outside.to_string_lossy().into_owned();
        for hostile in ["../outside", "sub/../../outside", &absolute] {
            let err = safe_subdir(&root_str(&f), hostile)
                .expect_err("must reject escaping subPath");
            assert!(err.contains("outside its workspace"), "{hostile}: got {err}");
        }
    }

    #[test]
    fn rejects_a_subdir_that_is_a_file() {
        let f = fixture();
        let err = safe_subdir(&root_str(&f), "deploy.bat").expect_err("must reject a file");
        assert!(err.contains("not a directory"), "got {err}");
    }
}
