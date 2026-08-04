use super::*;

#[cfg(unix)]
#[test]
fn secret_scrubber_contains_a_read_only_rewrite_failure() {
    use std::fs::OpenOptions;
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).unwrap();
    let _ = fs::remove_dir_all(&path);
    fs::write(
        &path,
        r#"{"connections":[{"id":"c","name":"C","type":"SSH","password":"secret"}],"folders":[]}"#,
    )
    .unwrap();

    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o400);
    fs::set_permissions(&path, permissions).unwrap();

    // Elevated runners can ignore the mode bits, so only assert where the failure is reproducible.
    if OpenOptions::new().write(true).open(&path).is_err() {
        scrub_stored_secrets(app.handle());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("secret"));
    }

    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(&path, permissions).unwrap();
    fs::remove_file(path).unwrap();
}
