//! npm's Windows `.cmd` shims (`node_modules\.bin\vtsls.cmd`) run `node <script> %*` through
//! cmd.exe. cmd.exe looks `node` up on a `PATH` it can only read up to 8191 characters, so a
//! long `PATH` makes every Node-based language server fail with "'node' is not recognized"
//! although Node is installed. Starting Node on the shim's script directly skips cmd.exe.

use std::path::{Path, PathBuf};

/// A `.cmd` shim is a few hundred bytes; anything larger is not npm's.
const MAX_SHIM: u64 = 16 * 1024;

/// The program and leading arguments that run what the npm `.cmd` shim `shim` runs: Node (the
/// `node.exe` next to the shim, else `node` on `search`) and the shim's script. `None` when
/// `shim` is not such a shim, its script is gone, or no Node is found: then the shim itself runs.
pub(crate) fn unwrap(shim: &Path, search: &std::ffi::OsStr) -> Option<(PathBuf, PathBuf)> {
    if !shim.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        return None;
    }
    if std::fs::metadata(shim).ok()?.len() > MAX_SHIM {
        return None;
    }
    let dir = shim.parent()?;
    // Windows takes `/` too; it keeps the lookup testable elsewhere.
    let script = dir.join(script_of(&std::fs::read_to_string(shim).ok()?)?.replace('\\', "/"));
    if !script.is_file() {
        return None;
    }
    let local = dir.join("node.exe");
    let node = if local.is_file() { local } else { ide_core::process::find_executable("node", search)? };
    Some((node, script))
}

/// Whether `shim` is an npm `.cmd` shim whose script is gone: npm can prune a package and leave
/// its `.bin` shim behind, which then dies with MODULE_NOT_FOUND on every start. Such a server is
/// missing (the UI offers to install it), not crashing.
pub(crate) fn is_dead(shim: &Path) -> bool {
    if !shim.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        return false;
    }
    if std::fs::metadata(shim).map_or(true, |m| m.len() > MAX_SHIM) {
        return false;
    }
    let Some(dir) = shim.parent() else { return false };
    let Ok(text) = std::fs::read_to_string(shim) else { return false };
    script_of(&text).is_some_and(|script| !dir.join(script.replace('\\', "/")).exists())
}

/// The script an npm `.cmd` shim passes to `%_prog%`, relative to the shim's directory:
/// `..\@vtsls\language-server\bin\vtsls.js` from `"%_prog%"  "%dp0%\..\@vtsls\...\vtsls.js" %*`.
/// Only shims whose program is Node (`SET "_prog=node"`) qualify.
fn script_of(text: &str) -> Option<&str> {
    if !text.to_ascii_lowercase().contains("set \"_prog=node\"") {
        return None;
    }
    let after = &text[text.find("\"%_prog%\"")? + "\"%_prog%\"".len()..];
    let quoted = after.trim_start().strip_prefix('"')?;
    let path = &quoted[..quoted.find('"')?];
    let relative = path.strip_prefix("%dp0%")?.trim_start_matches(['\\', '/']);
    (!relative.is_empty() && !relative.contains('%')).then_some(relative)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// npm 10's `cmd-shim` output for `@vtsls/language-server`.
    const VTSLS: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\..\\@vtsls\\language-server\\bin\\vtsls.js\" %*\r\n";

    #[test]
    fn the_script_of_an_npm_cmd_shim() {
        assert_eq!(script_of(VTSLS), Some("..\\@vtsls\\language-server\\bin\\vtsls.js"));
    }

    #[test]
    fn other_scripts_are_not_npm_node_shims() {
        for text in [
            "@echo off\r\n\"%~dp0..\\payload.exe\" %*\r\n",
            // Another program than Node behind `%_prog%`.
            &VTSLS.replace("SET \"_prog=node\"", "SET \"_prog=python\""),
            // A script named by an absolute path or another variable.
            &VTSLS.replace("\"%dp0%\\..\\@vtsls", "\"C:\\@vtsls"),
            &VTSLS.replace("\"%dp0%\\..\\@vtsls", "\"%dp0%\\%OTHER%\\@vtsls"),
        ] {
            assert_eq!(script_of(text), None, "{text}");
        }
    }

    #[test]
    fn a_shim_runs_on_the_node_next_to_it_or_on_the_search_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("tools/node_modules/.bin");
        let script = tmp.path().join("tools/node_modules/@vtsls/language-server/bin/vtsls.js");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "").unwrap();
        let shim = bin.join("vtsls.cmd");
        std::fs::write(&shim, VTSLS).unwrap();
        let node_dir = tmp.path().join("nodejs");
        std::fs::create_dir_all(&node_dir).unwrap();
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        std::fs::write(node_dir.join(node_name), "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(node_dir.join(node_name), std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let search = std::env::join_paths([&node_dir]).unwrap();

        let (node, found) = unwrap(&shim, &search).expect("an npm shim");
        assert_eq!(node, node_dir.join(node_name));
        assert_eq!(dunce::canonicalize(found).unwrap(), dunce::canonicalize(&script).unwrap());

        // A `node.exe` beside the shim wins, as the shim itself prefers it.
        std::fs::write(bin.join("node.exe"), "").unwrap();
        assert_eq!(unwrap(&shim, &search).map(|(n, _)| n), Some(bin.join("node.exe")));

        // Without its script or a Node, the shim itself runs.
        std::fs::remove_file(bin.join("node.exe")).unwrap();
        assert_eq!(unwrap(&shim, std::ffi::OsStr::new("")), None);
        assert!(!is_dead(&shim));
        std::fs::remove_file(&script).unwrap();
        assert_eq!(unwrap(&shim, &search), None);
        assert_eq!(unwrap(&bin.join("vtsls"), &search), None, "only `.cmd` shims");
        assert!(is_dead(&shim), "its package was pruned");
        assert!(!is_dead(&bin.join("vtsls")), "only `.cmd` shims");
        assert!(!is_dead(&bin.join("absent.cmd")));
    }
}
