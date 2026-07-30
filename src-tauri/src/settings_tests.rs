//! Settings default and merge tests.

use super::*;

/// Every field the renderer reads must exist on a fresh install. The first port's struct served
/// `darkMode`/`checkUpdates` instead, so the UI saw `undefined` for its theme, colors and shortcuts.
#[test]
fn defaults_expose_every_field_the_renderer_reads() {
    let d = defaults();
    assert_eq!(d["themeId"], json!("tokyo-night"));
    assert_eq!(d["fontSize"], json!(14));
    assert_eq!(d["smartColors"], json!(true));
    assert_eq!(d["checkUpdatesOnStartup"], json!(true));
    assert_eq!(d["skippedVersion"], json!(null));
    assert_eq!(d["workspaces"], json!([]));
    assert!(d["shortcuts"].is_object());
}

#[test]
fn defaults_do_not_carry_the_invented_field_names() {
    let d = defaults();
    for stale in ["darkMode", "checkUpdates", "themeMode"] {
        assert!(d.get(stale).is_none(), "{stale} is not part of the contract");
    }
}

/// The shortcut ids are what the renderer's keybinding layer looks up.
#[test]
fn default_shortcuts_cover_the_full_binding_set() {
    let s = default_shortcuts();
    for key in [
        "lock",
        "zoomIn",
        "zoomOut",
        "newSession",
        "newFolder",
        "openSettings",
        "toggleThemeMode",
        "layout1",
        "layout2",
        "layout4",
        "layout6",
        "layout8",
        "toggleSidebar",
    ] {
        assert!(s.get(key).and_then(|v| v.as_str()).is_some(), "{key} missing");
    }
    assert_eq!(s["lock"], json!("Ctrl+L"));
    assert_eq!(s["toggleSidebar"], json!("Ctrl+B"));
}

// ── Merging ──────────────────────────────────────────────────────────────────

/// The regression this fixes: `save` took a typed struct, so a partial write filled every absent
/// field with its default and wiped the user's theme and font size.
#[test]
fn a_partial_save_preserves_unrelated_fields() {
    let stored = json!({"themeId": "vercel", "fontSize": 18, "smartColors": false});
    let merged = merge_shallow(&stored, &json!({"skippedVersion": "1.2.3"}));

    assert_eq!(merged["skippedVersion"], json!("1.2.3"));
    assert_eq!(merged["themeId"], json!("vercel"), "theme must survive");
    assert_eq!(merged["fontSize"], json!(18), "font size must survive");
    assert_eq!(merged["smartColors"], json!(false));
}

#[test]
fn a_patch_overrides_the_base() {
    let merged = merge_shallow(&json!({"fontSize": 14}), &json!({"fontSize": 20}));
    assert_eq!(merged["fontSize"], json!(20));
}

#[test]
fn an_explicit_null_is_written_through() {
    // Clearing a skipped version is done by setting it to null; the merge must not drop the key.
    let merged = merge_shallow(&json!({"skippedVersion": "9.9.9"}), &json!({"skippedVersion": null}));
    assert_eq!(merged["skippedVersion"], json!(null));
}

/// Shallow, matching the Electron store's one-level spread: writing `shortcuts` replaces the object,
/// which is what makes clearing a single binding possible.
#[test]
fn nested_objects_are_replaced_not_deep_merged() {
    let stored = json!({"shortcuts": {"lock": "Ctrl+L", "zoomIn": "Ctrl+="}});
    let merged = merge_shallow(&stored, &json!({"shortcuts": {"lock": "Ctrl+Alt+L"}}));
    assert_eq!(merged["shortcuts"]["lock"], json!("Ctrl+Alt+L"));
    assert!(
        merged["shortcuts"].get("zoomIn").is_none(),
        "shortcuts must be replaced wholesale"
    );
}

#[test]
fn an_empty_patch_is_a_no_op() {
    let stored = json!({"themeId": "novel", "fontSize": 16});
    assert_eq!(merge_shallow(&stored, &json!({})), stored);
}

#[test]
fn a_non_object_patch_leaves_the_base_untouched() {
    let stored = json!({"themeId": "novel"});
    assert_eq!(merge_shallow(&stored, &json!("nonsense")), stored);
    assert_eq!(merge_shallow(&stored, &json!(null)), stored);
}

/// Stored values layer over the defaults, so a settings file written by an older version keeps every
/// newer field at its default instead of coming back absent.
#[test]
fn stored_values_layer_over_defaults() {
    let stored = json!({"fontSize": 22});
    let merged = merge_shallow(&defaults(), &stored);
    assert_eq!(merged["fontSize"], json!(22));
    assert_eq!(merged["themeId"], json!("tokyo-night"));
    assert!(merged["shortcuts"].is_object());
}

/// Unknown keys from a plugin or a newer build must survive a round-trip rather than being dropped.
#[test]
fn unknown_keys_are_preserved() {
    let merged = merge_shallow(&defaults(), &json!({"pluginSetting": {"a": 1}}));
    assert_eq!(merged["pluginSetting"], json!({"a": 1}));
}
