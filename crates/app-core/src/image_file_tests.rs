//! Tests for `image_file`: the allow-list, exclusions, containment and the size ceiling.

use super::*;
use std::path::PathBuf;

const PNG_HEADER: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

fn workspace() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-image-file")
        .tempdir()
        .expect("temp dir");
    let root = dunce::canonicalize(dir.path())
        .expect("canonical base")
        .join("ws");
    fs::create_dir_all(root.join("icons")).expect("create workspace");
    (dir, root)
}

fn root_str(root: &std::path::Path) -> String {
    root.to_string_lossy().into_owned()
}

#[test]
fn reads_allowed_image_bytes_verbatim() {
    let (_dir, root) = workspace();
    fs::write(root.join("icons/app.PNG"), PNG_HEADER).expect("write png");
    fs::write(root.join("icons/spin.gif"), b"GIF89a\0\0").expect("write gif");

    assert_eq!(
        read_image_file(&root_str(&root), "icons/app.PNG", &[]).expect("png reads"),
        PNG_HEADER
    );
    assert_eq!(
        read_image_file(&root_str(&root), "icons/spin.gif", &[]).expect("gif reads"),
        b"GIF89a\0\0"
    );
}

#[test]
fn refuses_non_image_excluded_and_svg_files() {
    let (_dir, root) = workspace();
    fs::write(root.join("notes.txt"), b"text").expect("write txt");
    fs::write(root.join("logo.svg"), b"<svg/>").expect("write svg");
    fs::write(root.join("photo.jpg"), b"\xFF\xD8\xFF").expect("write jpg");

    let refused = |path: &str, excluded: &[String]| {
        read_image_file(&root_str(&root), path, excluded).expect_err("refused")
    };
    assert!(refused("notes.txt", &[]).contains("cannot be shown as an image"));
    assert!(refused("logo.svg", &[]).contains("cannot be shown as an image"));
    assert!(refused("photo.jpg", &["JPG".to_string()]).contains("cannot be shown as an image"));
}

#[test]
fn refuses_paths_outside_the_workspace_and_directories() {
    let (dir, root) = workspace();
    let outside = dunce::canonicalize(dir.path())
        .expect("canonical base")
        .join("secret.png");
    fs::write(&outside, PNG_HEADER).expect("write outside png");
    fs::create_dir_all(root.join("folder.png")).expect("create png-named dir");

    assert!(read_image_file(&root_str(&root), "../secret.png", &[]).is_err());
    assert!(read_image_file(&root_str(&root), &outside.to_string_lossy(), &[]).is_err());
    assert!(read_image_file(&root_str(&root), "folder.png", &[])
        .expect_err("directory refused")
        .contains("only files"));
}

#[test]
fn refuses_images_over_the_ceiling() {
    let (_dir, root) = workspace();
    let file = fs::File::create(root.join("huge.webp")).expect("create webp");
    file.set_len(MAX_IMAGE_BYTES + 1).expect("grow sparse file");

    let error = read_image_file(&root_str(&root), "huge.webp", &[]).expect_err("too large");
    assert!(error.contains("viewer limit is 25.0 MB"), "{error}");
}
