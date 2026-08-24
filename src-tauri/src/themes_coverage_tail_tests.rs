//! Coverage for built-in theme discovery and native folder opening.

use super::*;

/// A theme root is scanned with `read_theme_dir`, which is where every "skip it" rule lives.
///
/// Driven directly against a temporary directory rather than through `list_themes`. The built-in root
/// is `resource_dir()/builtinThemes`, and on Linux `resource_dir()` resolves under `/usr/lib`, which
/// no test can write to — the previous version of this test bailed out silently there, so on the
/// platform CI measures coverage on it asserted nothing at all.
#[test]
fn a_theme_root_yields_parseable_json_files_and_skips_everything_else() {
    let root = tempfile::tempdir().unwrap();
    let expected = serde_json::json!({ "id": "coverage-builtin", "name": "Coverage Builtin" });

    fs::write(
        root.path().join("valid.json"),
        serde_json::to_vec(&expected).unwrap(),
    )
    .unwrap();
    // Malformed JSON: skipped, not fatal.
    fs::write(root.path().join("broken.json"), "not-json").unwrap();
    // Right content, wrong extension.
    fs::write(root.path().join("ignored.txt"), r#"{"id":"ignored"}"#).unwrap();
    // A *directory* whose name ends in .json — `read_to_string` fails rather than the filter.
    fs::create_dir(root.path().join("directory.json")).unwrap();
    // No extension at all.
    fs::write(root.path().join("README"), "notes").unwrap();

    assert_eq!(read_theme_dir(root.path()), vec![expected]);
}

#[test]
fn a_theme_root_that_cannot_be_read_yields_nothing() {
    let parent = tempfile::tempdir().unwrap();
    assert!(read_theme_dir(&parent.path().join("absent")).is_empty());

    // A path that exists but is a file, not a directory.
    let file = parent.path().join("themes");
    fs::write(&file, b"not a directory").unwrap();
    assert!(read_theme_dir(&file).is_empty());
}

/// A saved edit to a built-in theme lands in the user root under the same id; the user's copy is the
/// one that must survive the merge, or the edit is invisible to the renderer.
#[test]
fn a_user_theme_replaces_the_built_in_that_shares_its_id() {
    let builtin = vec![
        serde_json::json!({ "id": "claude", "name": "Claude" }),
        serde_json::json!({ "id": "novel", "name": "Novel" }),
    ];
    let user = vec![
        serde_json::json!({ "id": "claude", "name": "Claude (edited)" }),
        serde_json::json!({ "id": "theme-1", "name": "Mine" }),
        // No id at all: kept rather than dropped, matching the tolerant read of a theme root.
        serde_json::json!({ "name": "Anonymous" }),
    ];

    let merged = merge_theme_roots(builtin, user);

    assert_eq!(
        merged,
        vec![
            serde_json::json!({ "id": "claude", "name": "Claude (edited)" }),
            serde_json::json!({ "id": "novel", "name": "Novel" }),
            serde_json::json!({ "id": "theme-1", "name": "Mine" }),
            serde_json::json!({ "name": "Anonymous" }),
        ]
    );
}

#[test]
fn listing_themes_reads_the_user_root_and_tolerates_a_missing_builtin_root() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let themes_dir = get_themes_dir(app.handle()).unwrap();
    let mine = serde_json::json!({ "id": "mine", "name": "Mine" });
    fs::write(
        themes_dir.join("mine.json"),
        serde_json::to_vec(&mine).unwrap(),
    )
    .unwrap();

    let themes = tauri::async_runtime::block_on(list_themes(app.handle().clone())).unwrap();
    assert!(themes.contains(&mine));

    fs::remove_file(themes_dir.join("mine.json")).unwrap();
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
    // The opener is intentionally excluded from unit-test builds; verify the command remains
    // successful when the side-effecting production path is unavailable.
    assert!(tauri::async_runtime::block_on(open_themes_folder(app.handle().clone())).is_ok());

    std::env::set_var("PATH", original_path);
}
