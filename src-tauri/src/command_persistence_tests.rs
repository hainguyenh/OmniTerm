use super::*;
use serde_json::json;
use tempfile::TempDir;

#[test]
fn settings_theme_and_custom_art_commands_round_trip_through_app_data() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    let defaults = block_on(settings::get_settings(app.clone())).unwrap();
    assert_eq!(defaults["themeId"], json!("tokyo-night"));
    assert!(block_on(settings::save_settings(app.clone(), json!("invalid"))).is_err());

    block_on(settings::save_settings(
        app.clone(),
        json!({"themeId": "custom-dark", "fontSize": 19, "extra": true}),
    ))
    .unwrap();
    block_on(settings::save_settings(
        app.clone(),
        json!({"skippedVersion": "9.9.9"}),
    ))
    .unwrap();
    let saved = block_on(settings::get_settings(app.clone())).unwrap();
    assert_eq!(saved["themeId"], json!("custom-dark"));
    assert_eq!(saved["fontSize"], json!(19));
    assert_eq!(saved["skippedVersion"], json!("9.9.9"));
    assert_eq!(saved["extra"], json!(true));

    write_file(fixture.data_dir.join("settings.json"), b"{not-json");
    assert_eq!(settings::read_settings(&app)["themeId"], json!("tokyo-night"));

    assert!(block_on(themes::save_theme(app.clone(), json!({"name": "Missing id"}))).is_err());
    assert!(block_on(themes::save_theme(
        app.clone(),
        json!({"id": "../escape", "name": "Unsafe"}),
    ))
    .is_err());
    block_on(themes::save_theme(
        app.clone(),
        json!({"id": "coverage-theme", "name": "Coverage", "background": "#000"}),
    ))
    .unwrap();
    assert!(block_on(themes::list_themes(app.clone()))
        .unwrap()
        .iter()
        .any(|theme| theme["id"] == "coverage-theme"));
    block_on(themes::delete_theme(app.clone(), "coverage-theme".to_string())).unwrap();
    block_on(themes::delete_theme(app.clone(), "coverage-theme".to_string())).unwrap();
    assert!(!block_on(themes::list_themes(app.clone()))
        .unwrap()
        .iter()
        .any(|theme| theme["id"] == "coverage-theme"));

    let source = TempDir::new().unwrap();
    let png = source.path().join("art.png");
    write_file(&png, b"not-a-decoded-image-but-valid-for-copying");
    assert!(block_on(custom_art::upload_custom_art(
        app.clone(),
        "invalid".to_string(),
        png.to_string_lossy().into_owned(),
    ))
    .is_err());
    let stored_path = block_on(custom_art::upload_custom_art(
        app.clone(),
        "idle-dark".to_string(),
        png.to_string_lossy().into_owned(),
    ))
    .unwrap();
    assert!(Path::new(&stored_path).is_file());
    assert_eq!(
        block_on(custom_art::get_custom_art(app.clone(), "idle-dark".to_string())).unwrap(),
        Some(stored_path)
    );
    block_on(custom_art::remove_custom_art(
        app.clone(),
        "idle-dark".to_string(),
    ))
    .unwrap();
    assert_eq!(
        block_on(custom_art::get_custom_art(app, "idle-dark".to_string())).unwrap(),
        None
    );
}
