use super::IpcApp;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tauri::Manager;
use zip::write::SimpleFileOptions;

struct EnvRestore {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvRestore {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn fake_zenity(dir: &Path) -> PathBuf {
    let script = dir.join("zenity");
    fs::write(
        &script,
        r#"#!/bin/sh
case "$*" in
  *--question*)
    if [ "${OMNITERM_ZENITY_APPROVE:-1}" = "1" ]; then exit 0; else exit 1; fi
    ;;
esac
if [ "${OMNITERM_ZENITY_CANCEL:-0}" = "1" ]; then exit 1; fi
case "$*" in
  *--save*) printf '%s\n' "$OMNITERM_ZENITY_SAVE" ;;
  *) printf '%s\n' "$OMNITERM_ZENITY_OPEN" ;;
esac
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script, permissions).unwrap();
    script
}

fn fake_xdg_open(dir: &Path) -> PathBuf {
    let script = dir.join("xdg-open");
    fs::write(&script, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script, permissions).unwrap();
    script
}

fn write_plugin_package(path: &Path) {
    let file = fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    writer.start_file("package.json", options).unwrap();
    writer
        .write_all(
            br#"{
              "name": "dialog-plugin",
              "version": "1.2.3",
              "main": "dist/index.js",
              "omnitermPlugin": {
                "apiVersion": 2,
                "displayName": "Dialog Plugin",
                "permissions": ["connections"]
              }
            }"#,
        )
        .unwrap();
    writer.start_file("dist/index.js", options).unwrap();
    writer.write_all(b"module.exports = {};\n").unwrap();
    writer.finish().unwrap();
}

#[test]
fn ipc_native_dialog_commands_cover_success_cancel_and_approval() {
    let fixture = IpcApp::new();
    let tools = tempfile::tempdir().unwrap();
    let _zenity = fake_zenity(tools.path());
    let xdg_open = fake_xdg_open(tools.path());

    let source = tools.path().join("connections.json");
    let export = tools.path().join("exported.json");
    let package = tools.path().join("dialog-plugin.zip");
    fs::write(
        &source,
        r#"{"folders":[],"connections":[{"id":"dialog-ssh","name":"Dialog SSH","type":"SSH","host":"host.test","port":"22","user":"alice"}]}"#,
    )
    .unwrap();
    write_plugin_package(&package);

    let _path = EnvRestore::set("PATH", tools.path());
    let _dbus = EnvRestore::set(
        "DBUS_SESSION_BUS_ADDRESS",
        "unix:path=/definitely/missing/omniterm-test-bus",
    );
    let _runtime = EnvRestore::set("XDG_RUNTIME_DIR", tools.path());
    let _open = EnvRestore::set("OMNITERM_ZENITY_OPEN", &source);
    let _save = EnvRestore::set("OMNITERM_ZENITY_SAVE", &export);
    let _cancel = EnvRestore::set("OMNITERM_ZENITY_CANCEL", "0");
    let _approve = EnvRestore::set("OMNITERM_ZENITY_APPROVE", "1");

    let log_dir = fixture.ok("reveal_log", json!({}));
    assert!(Path::new(log_dir.as_str().expect("log path")).is_dir());
    fs::remove_file(&xdg_open).unwrap();
    assert!(fixture.invoke("reveal_log", json!({})).is_ok());
    assert!(fixture.invoke("open_themes_folder", json!({})).is_ok());

    assert_eq!(
        fixture.ok(
            "export_json",
            json!({ "suggestedName": "exported.json", "content": "{\"saved\":true}" }),
        ),
        json!(true)
    );
    assert_eq!(fs::read_to_string(&export).unwrap(), r#"{"saved":true}"#);

    let source_text = fs::read_to_string(&source).unwrap();
    assert_eq!(
        fixture.ok("import_json", json!({})).as_str(),
        Some(source_text.as_str())
    );
    let imported = fixture.ok("import_file", json!({}));
    assert_eq!(imported["connections"][0]["id"], "dialog-ssh");

    std::env::set_var("OMNITERM_ZENITY_OPEN", &package);
    let installed = fixture.ok("install_plugin_package", json!({}));
    assert_eq!(installed["installed"], true);
    assert_eq!(installed["id"], "dialog-plugin");
    assert_eq!(installed["name"], "Dialog Plugin");
    assert_eq!(installed["version"], "1.2.3");
    assert_eq!(installed["restartRequired"], false);
    let installed_dir = fixture.app_data_dir.join("plugins/dialog-plugin");
    assert!(installed_dir.join("package.json").is_file());
    assert!(installed_dir.join("dist/index.js").is_file());

    let handle = fixture.handle();
    let host = handle.state::<crate::plugin_host::PluginHost>();
    tauri::async_runtime::block_on(host.start(&handle)).unwrap();
    let replaced = fixture.ok("install_plugin_package", json!({}));
    assert_eq!(replaced["installed"], true);
    assert_eq!(replaced["id"], "dialog-plugin");
    assert_eq!(replaced["restartRequired"], true);

    assert_eq!(
        fixture.ok("remove_plugin", json!({ "id": "dialog-plugin" })),
        json!(true)
    );
    assert!(!installed_dir.exists());

    std::env::set_var("OMNITERM_ZENITY_SAVE", tools.path());
    assert!(fixture
        .invoke(
            "export_json",
            json!({ "suggestedName": "blocked.json", "content": "ignored" }),
        )
        .is_err());
    std::env::set_var("OMNITERM_ZENITY_SAVE", &export);

    let missing = tools.path().join("missing.json");
    std::env::set_var("OMNITERM_ZENITY_OPEN", &missing);
    assert!(fixture.invoke("import_json", json!({})).is_err());
    assert!(fixture.invoke("import_file", json!({})).is_err());

    let invalid_package = tools.path().join("invalid-plugin.zip");
    fs::write(&invalid_package, b"not a zip archive").unwrap();
    std::env::set_var("OMNITERM_ZENITY_OPEN", &invalid_package);
    assert!(fixture
        .invoke("install_plugin_package", json!({}))
        .is_err());

    std::env::set_var("OMNITERM_ZENITY_OPEN", &package);
    std::env::set_var("OMNITERM_ZENITY_CANCEL", "1");
    assert_eq!(
        fixture.ok(
            "export_json",
            json!({ "suggestedName": "cancel.json", "content": "ignored" }),
        ),
        json!(false)
    );
    assert_eq!(fixture.ok("import_json", json!({})), Value::Null);
    assert_eq!(fixture.ok("import_file", json!({})), Value::Null);
    assert_eq!(fixture.ok("install_plugin_package", json!({})), Value::Null);

    std::env::set_var("OMNITERM_ZENITY_CANCEL", "0");
    std::env::set_var("OMNITERM_ZENITY_APPROVE", "0");
    assert_eq!(fixture.ok("install_plugin_package", json!({})), Value::Null);
    assert!(!installed_dir.exists());
}
