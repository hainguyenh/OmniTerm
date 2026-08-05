//! Coverage for built-in theme discovery and native folder opening.

use super::*;
use tauri::Manager;

#[test]
fn builtin_theme_listing_accepts_valid_json_and_skips_every_invalid_entry_shape() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let Ok(resource_dir) = app.path().resource_dir() else {
        return;
    };
    let builtin_dir = resource_dir.join("builtinThemes");
    if fs::create_dir_all(&builtin_dir).is_err() {
        return;
    }

    let valid = builtin_dir.join("coverage-valid.json");
    let broken = builtin_dir.join("coverage-broken.json");
    let ignored = builtin_dir.join("coverage-ignored.txt");
    let directory = builtin_dir.join("coverage-directory.json");
    let _ = fs::remove_file(&valid);
    let _ = fs::remove_file(&broken);
    let _ = fs::remove_file(&ignored);
    let _ = fs::remove_dir_all(&directory);

    let expected = serde_json::json!({
        "id": "coverage-builtin",
        "name": "Coverage Builtin"
    });
    if fs::write(&valid, serde_json::to_vec(&expected).unwrap()).is_err() {
        return;
    }
    if fs::write(&broken, "not-json").is_err() {
        let _ = fs::remove_file(&valid);
        return;
    }
    if fs::write(&ignored, r#"{"id":"coverage-ignored"}"#).is_err() {
        let _ = fs::remove_file(&valid);
        let _ = fs::remove_file(&broken);
        return;
    }
    if fs::create_dir(&directory).is_err() {
        let _ = fs::remove_file(&valid);
        let _ = fs::remove_file(&broken);
        let _ = fs::remove_file(&ignored);
        return;
    }

    let themes = tauri::async_runtime::block_on(list_themes(app.handle().clone())).unwrap();
    assert!(themes.contains(&expected));
    assert!(!themes.contains(&serde_json::json!({"id": "coverage-ignored"})));

    let _ = fs::remove_file(valid);
    let _ = fs::remove_file(broken);
    let _ = fs::remove_file(ignored);
    let _ = fs::remove_dir(directory);
}

#[test]
fn user_theme_listing_treats_an_unreadable_theme_root_as_empty() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let themes_dir = get_themes_dir(app.handle()).unwrap();
    let _ = fs::remove_dir_all(&themes_dir);
    let _ = fs::remove_file(&themes_dir);
    fs::create_dir_all(&themes_dir).unwrap();
    let builtins = tauri::async_runtime::block_on(list_themes(app.handle().clone())).unwrap();

    fs::remove_dir_all(&themes_dir).unwrap();
    fs::write(&themes_dir, b"not a directory").unwrap();
    let themes = tauri::async_runtime::block_on(list_themes(app.handle().clone())).unwrap();
    assert_eq!(themes, builtins);

    fs::remove_file(themes_dir).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn open_themes_folder_covers_the_primary_opener_and_missing_fallback() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::test_support::lock();
    let original_path = std::env::var_os("PATH").expect("test process has PATH");
    let tools = tempfile::tempdir().unwrap();
    let opener = tools.path().join("xdg-open");
    fs::write(&opener, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&opener).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&opener, permissions).unwrap();
    std::env::set_var("PATH", tools.path());

    let app = crate::test_support::mock_app();
    assert_eq!(
        tauri::async_runtime::block_on(open_themes_folder(app.handle().clone())),
        Ok(())
    );

    fs::remove_file(opener).unwrap();
    assert!(tauri::async_runtime::block_on(open_themes_folder(app.handle().clone())).is_err());

    std::env::set_var("PATH", original_path);
}
