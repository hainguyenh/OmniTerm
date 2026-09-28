use super::*;
use crate::test_support;
use std::fs;

#[test]
fn pasted_images_land_in_the_app_attachments_folder_and_are_listed() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let dir = attachments_dir(&handle).expect("attachments dir");
    let _ = fs::remove_dir_all(&dir);

    let path = tauri::async_runtime::block_on(save_temp_image(handle.clone(), vec![1, 2, 3]))
        .expect("save pasted image");
    let saved = PathBuf::from(&path);
    assert_eq!(saved.parent(), Some(dir.as_path()));
    assert!(saved
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("paste-") && name.ends_with(".png")));

    let listing = tauri::async_runtime::block_on(list_attachments(handle.clone())).expect("list");
    assert_eq!(listing.dir, dir.to_string_lossy());
    assert!(listing.files.iter().any(|info| info.path == path));

    let empty = tauri::async_runtime::block_on(save_temp_image(handle, Vec::new()));
    assert!(empty.is_err());
    let _ = fs::remove_dir_all(&dir);
}
