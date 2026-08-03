//! Unit tests for plugin package validation. Native dialogs and app restart are integration concerns;
//! these tests cover every pure rejection path before an archive can write executable files.

use super::*;
use crate::test_support;

fn manifest() -> Vec<u8> {
    br#"{"name":"@x/demo","version":"1.2.3","main":"dist/index.js","omnitermPlugin":{"apiVersion":2,"displayName":"Demo","permissions":["connections"]}}"#.to_vec()
}

#[test]
fn safe_directory_names_replace_only_filesystem_metacharacters() {
    assert_eq!(safe_dir_name("@scope/demo"), "@scope_demo");
    assert_eq!(safe_dir_name("a\\b?c%d*e:f|g\"h<i>j"), "a_b_c_d_e_f_g_h_i_j");
    assert_eq!(safe_dir_name("normal.plugin-name"), "normal.plugin-name");
}

#[test]
fn checked_directory_names_reject_empty_special_and_control_names() {
    for unsafe_id in ["", ".", "..", "bad\nname", "bad\0name"] {
        assert!(checked_dir_name(unsafe_id).is_err(), "{unsafe_id:?} must be rejected");
    }
    assert_eq!(checked_dir_name("@x/demo").unwrap(), "@x_demo");
}

#[test]
fn manifest_reads_supported_metadata_and_defaults() {
    let parsed = parse_manifest(&manifest()).unwrap();
    assert_eq!(parsed.id, "@x/demo");
    assert_eq!(parsed.name, "Demo");
    assert_eq!(parsed.version, "1.2.3");
    assert_eq!(parsed.main, "dist/index.js");
    assert_eq!(parsed.permissions, vec!["connections"]);

    let minimal = br#"{"name":"demo","omnitermPlugin":{"apiVersion":2}}"#;
    let parsed = parse_manifest(minimal).unwrap();
    assert_eq!(parsed.name, "Unnamed plugin");
    assert_eq!(parsed.version, "0.0.0");
    assert_eq!(parsed.main, "dist/index.js");
    assert!(parsed.permissions.is_empty());
}

#[test]
fn manifest_rejects_invalid_json_and_non_plugin_packages() {
    assert!(parse_manifest(b"not json").unwrap_err().contains("not valid JSON"));
    assert!(parse_manifest(br#"{"name":"demo"}"#)
        .unwrap_err()
        .contains("not an OmniTerm plugin"));
    assert!(parse_manifest(br#"{"omnitermPlugin":{"apiVersion":2}}"#)
        .unwrap_err()
        .contains("no valid name"));
}

#[test]
fn manifest_requires_api_v2() {
    for value in [
        &br#"{"name":"x","omnitermPlugin":{}}"#[..],
        &br#"{"name":"x","omnitermPlugin":{"apiVersion":1}}"#[..],
        &br#"{"name":"x","omnitermPlugin":{"apiVersion":3}}"#[..],
    ] {
        assert!(parse_manifest(value).unwrap_err().contains("requires version 2"));
    }
}

#[test]
fn manifest_requires_string_known_permissions() {
    let non_string = br#"{"name":"x","omnitermPlugin":{"apiVersion":2,"permissions":[1]}}"#;
    assert!(parse_manifest(non_string)
        .unwrap_err()
        .contains("permissions must be strings"));

    for permission in ["root", "credentials"] {
        let bytes = format!(
            r#"{{"name":"x","omnitermPlugin":{{"apiVersion":2,"permissions":["{permission}"]}}}}"#,
        );
        assert!(parse_manifest(bytes.as_bytes())
            .unwrap_err()
            .contains("unknown permission"));
    }

    let all = KNOWN_PERMISSIONS
        .iter()
        .map(|permission| format!(r#""{permission}""#))
        .collect::<Vec<_>>()
        .join(",");
    let bytes = format!(
        r#"{{"name":"x","omnitermPlugin":{{"apiVersion":2,"permissions":[{all}]}}}}"#,
    );
    assert_eq!(parse_manifest(bytes.as_bytes()).unwrap().permissions.len(), KNOWN_PERMISSIONS.len());
}

#[test]
fn manifest_rejects_unsafe_package_and_entrypoint_names() {
    {
        let id = "..";
        let bytes = format!(r#"{{"name":"{id}","omnitermPlugin":{{"apiVersion":2}}}}"#);
        assert!(parse_manifest(bytes.as_bytes()).unwrap_err().contains("unsafe"));
    }
    for main in ["../evil.js", "dist/../../evil.js", "/tmp/evil.js", "..\\evil.js"] {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "name": "x",
            "main": main,
            "omnitermPlugin": { "apiVersion": 2 },
        }))
        .unwrap();
        assert!(parse_manifest(&bytes).unwrap_err().contains("main path is unsafe"));
    }
}

fn is_symlink_mode(mode: u32) -> bool {
    mode & 0o170000 == 0o120000
}

fn zip_file(entries: &[(&str, &[u8], Option<u32>)]) -> tempfile::NamedTempFile {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    for (name, bytes, mode) in entries {
        let mut options = SimpleFileOptions::default();
        if let Some(mode) = mode {
            options = options.unix_permissions(*mode);
        }
        // `unix_permissions` masks its argument down to `0o777`, dropping the file-type bits, so a
        // mode of `0o120777` does not produce a symlink entry — it produces an ordinary file that
        // `extract_validated` accepts, and the symlink rejection below was never being exercised.
        // `add_symlink` is what sets `S_IFLNK` in the external attributes `unix_mode()` reads back.
        if mode.is_some_and(is_symlink_mode) {
            writer
                .add_symlink(*name, String::from_utf8_lossy(bytes), options)
                .unwrap();
            continue;
        }
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    file
}

#[test]
fn package_archive_manifest_and_extraction_cover_safe_and_unsafe_entries() {
    let package = manifest();
    let archive_file = zip_file(&[
        ("package.json", package.as_slice(), None),
        ("dist/index.js", b"module.exports = {}", None),
    ]);
    let mut archive = zip::ZipArchive::new(fs::File::open(archive_file.path()).unwrap()).unwrap();
    let parsed = read_package_manifest(&mut archive).unwrap();
    assert_eq!(parsed.id, "@x/demo");

    let destination = tempfile::TempDir::new().unwrap();
    extract_validated(&mut archive, destination.path()).unwrap();
    assert!(destination.path().join("dist/index.js").is_file());

    let missing = zip_file(&[("dist/index.js", b"x", None)]);
    let mut archive = zip::ZipArchive::new(fs::File::open(missing.path()).unwrap()).unwrap();
    assert!(read_package_manifest(&mut archive)
        .unwrap_err()
        .contains("must contain package.json"));

    let unsafe_zip = zip_file(&[("../escape.js", b"x", None)]);
    let mut archive = zip::ZipArchive::new(fs::File::open(unsafe_zip.path()).unwrap()).unwrap();
    assert!(extract_validated(&mut archive, destination.path())
        .unwrap_err()
        .contains("unsafe path"));

    let symlink_zip = zip_file(&[("link", b"target", Some(0o120777))]);
    let mut archive = zip::ZipArchive::new(fs::File::open(symlink_zip.path()).unwrap()).unwrap();
    assert!(extract_validated(&mut archive, destination.path())
        .unwrap_err()
        .contains("symbolic links"));
}

#[test]
fn oversized_package_manifest_is_rejected_before_json_parsing() {
    let oversized = vec![b' '; 1024 * 1024 + 1];
    let file = zip_file(&[("package.json", oversized.as_slice(), None)]);
    let mut archive = zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();
    assert!(read_package_manifest(&mut archive)
        .unwrap_err()
        .contains("package.json is too large"));
}


#[test]
fn extraction_creates_explicit_directories_and_nested_files() {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    writer
        .add_directory("dist/assets/", SimpleFileOptions::default())
        .unwrap();
    writer
        .start_file("dist/assets/index.js", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"module.exports = 1").unwrap();
    writer.finish().unwrap();

    let mut archive = zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();
    let destination = tempfile::TempDir::new().unwrap();
    extract_validated(&mut archive, destination.path()).unwrap();
    assert!(destination.path().join("dist/assets").is_dir());
    assert_eq!(
        fs::read(destination.path().join("dist/assets/index.js")).unwrap(),
        b"module.exports = 1"
    );
}

#[test]
fn package_archive_rejects_more_than_the_file_limit() {
    use zip::write::SimpleFileOptions;

    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    for index in 0..=MAX_FILES {
        writer
            .start_file(format!("entry-{index}"), SimpleFileOptions::default())
            .unwrap();
    }
    writer.finish().unwrap();

    let mut archive = zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();
    assert!(read_package_manifest(&mut archive)
        .unwrap_err()
        .contains("too many files"));
}

#[test]
fn install_transaction_installs_replaces_and_cleans_failed_staging() {
    let plugins = tempfile::TempDir::new().unwrap();
    let package = manifest();

    let first = zip_file(&[
        ("package.json", package.as_slice(), None),
        ("dist/index.js", b"first", None),
    ]);
    let mut archive = zip::ZipArchive::new(fs::File::open(first.path()).unwrap()).unwrap();
    let parsed = read_package_manifest(&mut archive).unwrap();
    install_validated_archive(&mut archive, plugins.path(), &parsed).unwrap();
    let target = plugins.path().join("@x_demo");
    assert_eq!(fs::read(target.join("dist/index.js")).unwrap(), b"first");

    let replacement = zip_file(&[
        ("package.json", package.as_slice(), None),
        ("dist/index.js", b"second", None),
    ]);
    let mut archive = zip::ZipArchive::new(fs::File::open(replacement.path()).unwrap()).unwrap();
    let parsed = read_package_manifest(&mut archive).unwrap();
    install_validated_archive(&mut archive, plugins.path(), &parsed).unwrap();
    assert_eq!(fs::read(target.join("dist/index.js")).unwrap(), b"second");
    assert!(fs::read_dir(plugins.path()).unwrap().all(|entry| {
        let name = entry.unwrap().file_name();
        !name.to_string_lossy().starts_with(".replace-")
    }));

    let missing_main = zip_file(&[("package.json", package.as_slice(), None)]);
    let mut archive = zip::ZipArchive::new(fs::File::open(missing_main.path()).unwrap()).unwrap();
    let parsed = read_package_manifest(&mut archive).unwrap();
    assert!(install_validated_archive(&mut archive, plugins.path(), &parsed)
        .unwrap_err()
        .contains("entry point"));
    assert!(fs::read_dir(plugins.path()).unwrap().all(|entry| {
        let name = entry.unwrap().file_name();
        !name.to_string_lossy().starts_with(".install-")
    }));
    assert_eq!(fs::read(target.join("dist/index.js")).unwrap(), b"second");
}

#[test]
fn installed_plugin_directory_and_remove_command_validate_identity() {
    use tauri::Manager;

    // Writes under the mock app's data directory, which every mock app in this binary shares.
    let _guard = test_support::lock();

    let app = test_support::mock_app();
    assert!(app.manage(PluginHost::new()));
    let handle = app.handle().clone();
    let root = installed_dir(&handle).unwrap();
    let _ = fs::remove_dir_all(&root);
    let target = root.join("demo");
    fs::create_dir_all(&target).unwrap();
    fs::write(
        target.join("package.json"),
        br#"{"name":"other","omnitermPlugin":{"apiVersion":2}}"#,
    )
    .unwrap();
    let host = app.state::<PluginHost>();
    assert!(tauri::async_runtime::block_on(remove_plugin(
        handle.clone(),
        host.clone(),
        "demo".to_string(),
    ))
    .unwrap_err()
    .contains("identity does not match"));

    fs::write(
        target.join("package.json"),
        br#"{"name":"demo","omnitermPlugin":{"apiVersion":2}}"#,
    )
    .unwrap();
    assert!(tauri::async_runtime::block_on(remove_plugin(
        handle.clone(),
        host,
        "demo".to_string(),
    ))
    .unwrap());
    assert!(!target.exists());
    assert!(tauri::async_runtime::block_on(remove_plugin(
        handle,
        app.state::<PluginHost>(),
        "demo".to_string(),
    ))
    .is_err());
    let _ = fs::remove_dir_all(root);
}
