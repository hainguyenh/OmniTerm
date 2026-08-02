use super::*;
use std::fs::File;
use std::io::Write;
use tempfile::TempDir;

#[test]
fn test_valid_slots() {
    assert!(is_valid_slot("idle-light"));
    assert!(is_valid_slot("idle-dark"));
    assert!(is_valid_slot("loading-light"));
    assert!(is_valid_slot("loading-dark"));
    assert!(!is_valid_slot("idle"));
    assert!(!is_valid_slot("loading"));
    assert!(!is_valid_slot("other"));
    assert!(!is_valid_slot(""));
}

#[test]
fn test_has_valid_extension() {
    assert!(has_valid_extension(Path::new("file.png")));
    assert!(has_valid_extension(Path::new("file.JPG")));
    assert!(has_valid_extension(Path::new("file.svg")));
    assert!(!has_valid_extension(Path::new("file.txt")));
    assert!(!has_valid_extension(Path::new("file")));
}

fn create_dummy_file(dir: &Path, name: &str, size: usize) -> PathBuf {
    let path = dir.join(name);
    let mut file = File::create(&path).unwrap();
    let data = vec![0; size];
    file.write_all(&data).unwrap();
    path
}

#[test]
fn test_upload_custom_art() {
    let tmp = TempDir::new().unwrap();
    let src_dir = tmp.path().join("src");
    fs::create_dir_all(&src_dir).unwrap();
    
    let art_dir = tmp.path().join("custom-art");
    
    // Test valid upload
    let img_path = create_dummy_file(&src_dir, "test.png", 1024);
    let res = upload_custom_art_impl(&art_dir, "idle-light", &img_path);
    assert!(res.is_ok());
    
    let uploaded_path = PathBuf::from(res.unwrap());
    assert!(uploaded_path.exists());
    assert_eq!(uploaded_path.file_name().unwrap(), "idle-light.png");
    
    // Test overwrite with different extension
    let img2_path = create_dummy_file(&src_dir, "test2.jpg", 1024);
    let res2 = upload_custom_art_impl(&art_dir, "idle-light", &img2_path);
    assert!(res2.is_ok());
    
    let uploaded2_path = PathBuf::from(res2.unwrap());
    assert!(uploaded2_path.exists());
    assert_eq!(uploaded2_path.file_name().unwrap(), "idle-light.jpg");
    
    // Ensure old file is gone
    assert!(!uploaded_path.exists());
    
    // Test file size validation (> 2 MB)
    let large_img = create_dummy_file(&src_dir, "large.png", 3 * 1024 * 1024);
    let res_large = upload_custom_art_impl(&art_dir, "loading-light", &large_img);
    assert!(res_large.is_err());
    
    // Test invalid extension
    let txt_file = create_dummy_file(&src_dir, "test.txt", 1024);
    let res_txt = upload_custom_art_impl(&art_dir, "loading-light", &txt_file);
    assert!(res_txt.is_err());
    
    // Test invalid slot
    let res_slot = upload_custom_art_impl(&art_dir, "invalid_slot", &img_path);
    assert!(res_slot.is_err());
}

#[test]
fn test_get_and_remove_custom_art() {
    let tmp = TempDir::new().unwrap();
    let src_dir = tmp.path().join("src");
    fs::create_dir_all(&src_dir).unwrap();
    let art_dir = tmp.path().join("custom-art");
    
    // Get before any upload
    let res_get1 = get_custom_art_impl(&art_dir, "idle-light");
    assert!(res_get1.is_ok());
    assert!(res_get1.unwrap().is_none());
    
    // Upload and get
    let img_path = create_dummy_file(&src_dir, "test.png", 1024);
    upload_custom_art_impl(&art_dir, "idle-light", &img_path).unwrap();
    
    let res_get2 = get_custom_art_impl(&art_dir, "idle-light");
    assert!(res_get2.is_ok());
    let path_opt = res_get2.unwrap();
    assert!(path_opt.is_some());
    assert!(path_opt.unwrap().ends_with("idle-light.png"));
    
    // Remove
    let res_rm = remove_custom_art_impl(&art_dir, "idle-light");
    assert!(res_rm.is_ok());
    
    // Get after remove
    let res_get3 = get_custom_art_impl(&art_dir, "idle-light");
    assert!(res_get3.is_ok());
    assert!(res_get3.unwrap().is_none());
    
    // Ensure actual file is deleted
    assert!(!art_dir.join("idle-light.png").exists());
}
