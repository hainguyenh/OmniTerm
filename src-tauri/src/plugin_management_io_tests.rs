use super::*;
use std::io::Write;
use zip::write::SimpleFileOptions;

fn archive(entries: &[(&str, &[u8], bool)]) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    for (name, bytes, directory) in entries {
        if *directory {
            writer
                .add_directory(*name, SimpleFileOptions::default())
                .unwrap();
        } else {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
    }
    writer.finish().unwrap();
    file
}

#[test]
fn extraction_reports_an_explicit_directory_that_collides_with_a_file() {
    let package = archive(&[("dist/", b"", true)]);
    let mut zip = zip::ZipArchive::new(fs::File::open(package.path()).unwrap()).unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::write(destination.path().join("dist"), b"file").unwrap();

    assert!(extract_validated(&mut zip, destination.path()).is_err());
}

#[test]
fn extraction_reports_a_parent_directory_that_collides_with_a_file() {
    let package = archive(&[("dist/index.js", b"code", false)]);
    let mut zip = zip::ZipArchive::new(fs::File::open(package.path()).unwrap()).unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::write(destination.path().join("dist"), b"file").unwrap();

    assert!(extract_validated(&mut zip, destination.path()).is_err());
}

#[test]
fn extraction_reports_an_output_file_that_is_already_a_directory() {
    let package = archive(&[("index.js", b"code", false)]);
    let mut zip = zip::ZipArchive::new(fs::File::open(package.path()).unwrap()).unwrap();
    let destination = tempfile::tempdir().unwrap();
    fs::create_dir_all(destination.path().join("index.js")).unwrap();

    assert!(extract_validated(&mut zip, destination.path()).is_err());
}

#[test]
fn installation_reports_a_plugins_root_that_is_a_file() {
    let manifest_bytes = br#"{
      "name": "io-plugin",
      "main": "dist/index.js",
      "omnitermPlugin": { "apiVersion": 2 }
    }"#;
    let package = archive(&[
        ("package.json", manifest_bytes, false),
        ("dist/index.js", b"code", false),
    ]);
    let mut zip = zip::ZipArchive::new(fs::File::open(package.path()).unwrap()).unwrap();
    let manifest = read_package_manifest(&mut zip).unwrap();
    let root = tempfile::tempdir().unwrap();
    let plugins = root.path().join("plugins");
    fs::write(&plugins, b"file").unwrap();

    assert!(install_validated_archive(&mut zip, &plugins, &manifest).is_err());
}

#[cfg(unix)]
#[test]
fn removal_reports_an_installed_manifest_that_cannot_be_read() {
    use std::os::unix::fs::PermissionsExt;
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    assert!(app.manage(PluginHost::new()));
    let root = installed_dir(app.handle()).unwrap();
    let target = root.join("unreadable-plugin");
    fs::create_dir_all(&target).unwrap();
    let package = target.join("package.json");
    fs::write(
        &package,
        br#"{"name":"unreadable-plugin","omnitermPlugin":{"apiVersion":2}}"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&package).unwrap().permissions();
    permissions.set_mode(0o000);
    fs::set_permissions(&package, permissions).unwrap();

    // Root can still read mode-000 files; skip only where this failure cannot be reproduced.
    if fs::read(&package).is_ok() {
        let mut permissions = fs::metadata(&package).unwrap().permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&package, permissions).unwrap();
        fs::remove_dir_all(root).unwrap();
        return;
    }

    let result = tauri::async_runtime::block_on(remove_plugin(
        app.handle().clone(),
        app.state::<PluginHost>(),
        "unreadable-plugin".to_string(),
    ));
    assert!(result.is_err());

    let mut permissions = fs::metadata(&package).unwrap().permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(&package, permissions).unwrap();
    fs::remove_dir_all(root).unwrap();
}
