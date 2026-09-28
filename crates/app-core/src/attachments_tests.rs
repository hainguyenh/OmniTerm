use super::*;

fn dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("create temp dir")
}

#[test]
fn sanitize_keeps_only_the_last_safe_component() {
    assert_eq!(sanitize_file_name("report.pdf"), "report.pdf");
    assert_eq!(sanitize_file_name("..\\..\\Windows\\evil.exe"), "evil.exe");
    assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
    assert_eq!(sanitize_file_name("a<b>c:d\"e|f?g*h.txt"), "abcdefgh.txt");
    assert_eq!(sanitize_file_name("line\nbreak\u{0}.md"), "linebreak.md");
    assert_eq!(sanitize_file_name(".bashrc"), "bashrc");
    assert_eq!(sanitize_file_name("trailing. . "), "trailing");
    assert_eq!(sanitize_file_name("trailing."), "trailing");
}

#[test]
fn sanitize_never_returns_an_empty_or_device_name() {
    assert_eq!(sanitize_file_name(""), "attachment");
    assert_eq!(sanitize_file_name(".."), "attachment");
    assert_eq!(sanitize_file_name("C:\\"), "attachment");
    assert_eq!(sanitize_file_name("CON.txt"), "_CON.txt");
    assert_eq!(sanitize_file_name("nul"), "_nul");
    assert_eq!(sanitize_file_name("com1.tar.gz"), "_com1.tar.gz");
}

#[test]
fn sanitize_caps_the_stem_and_normalizes_the_extension() {
    let long = format!("{}.PNG", "x".repeat(300));
    let safe = sanitize_file_name(&long);
    assert_eq!(safe, format!("{}.png", "x".repeat(80)));
    // An extension that is not short and alphanumeric is kept as part of the stem.
    assert_eq!(sanitize_file_name("notes.draft-v2"), "notes.draft-v2");
}

#[test]
fn saves_with_a_unique_stamped_name_and_never_overwrites() {
    let temp = dir();
    let first = save_attachment(temp.path(), "shot.png", b"one", 42).expect("save first");
    let second = save_attachment(temp.path(), "shot.png", b"two", 42).expect("save second");
    assert_eq!(first.name, "shot-42.png");
    assert_eq!(second.name, "shot-42-1.png");
    assert_eq!(first.kind, AttachmentKind::Image);
    assert_eq!(first.size, 3);
    assert_eq!(fs::read(&first.path).expect("read first"), b"one");
    assert_eq!(fs::read(&second.path).expect("read second"), b"two");

    let no_ext = save_attachment(temp.path(), "barename", b"bare", 42).expect("save no ext");
    assert_eq!(no_ext.name, "barename-42");
}

#[test]
fn saves_inside_the_folder_whatever_the_hint() {
    let temp = dir();
    let folder = temp.path().join("attachments");
    let saved = save_attachment(&folder, "..\\..\\outside.pdf", b"%PDF", 7).expect("save");
    assert_eq!(Path::new(&saved.path).parent(), Some(folder.as_path()));
    assert_eq!(saved.name, "outside-7.pdf");
    assert_eq!(saved.kind, AttachmentKind::File);
}

#[test]
fn refuses_empty_and_oversized_payloads() {
    let temp = dir();
    let empty = save_attachment(temp.path(), "a.txt", b"", 1).expect_err("empty");
    assert_eq!(empty.kind(), io::ErrorKind::InvalidInput);
    let big = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
    let oversized = save_attachment(temp.path(), "a.bin", &big, 1).expect_err("oversized");
    assert_eq!(oversized.kind(), io::ErrorKind::InvalidInput);
    assert!(list_attachments(temp.path()).is_empty());
}

#[test]
fn lists_files_only_and_tolerates_a_missing_folder() {
    let temp = dir();
    assert!(list_attachments(&temp.path().join("missing")).is_empty());
    save_attachment(temp.path(), "a.txt", b"a", 1).expect("save a");
    save_attachment(temp.path(), "b.jpg", b"bb", 2).expect("save b");
    fs::create_dir(temp.path().join("nested")).expect("mkdir");
    let listed = list_attachments(temp.path());
    let mut names: Vec<_> = listed.iter().map(|info| info.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["a-1.txt", "b-2.jpg"]);
    assert_eq!(listed.iter().map(|info| info.size).sum::<u64>(), 3);
}

#[test]
fn clear_removes_the_folder_contents_and_legacy_temp_pastes_only() {
    let temp = dir();
    let folder = temp.path().join("attachments");
    let os_temp = temp.path().join("tmp");
    fs::create_dir_all(&os_temp).expect("mkdir tmp");
    save_attachment(&folder, "a.txt", b"abc", 1).expect("save");
    fs::write(os_temp.join("omniterm-paste-123.png"), b"png!").expect("legacy");
    fs::write(os_temp.join("someone-else.png"), b"keep").expect("other");
    fs::write(os_temp.join("omniterm-paste-notes.txt"), b"keep").expect("other ext");

    assert_eq!(legacy_pastes(&os_temp).len(), 1);
    let report = clear_attachments(&folder, Some(&os_temp));
    assert_eq!(
        report,
        ClearReport {
            removed: 2,
            bytes: 7,
            failed: 0
        }
    );
    assert!(list_attachments(&folder).is_empty());
    assert!(os_temp.join("someone-else.png").exists());
    assert!(os_temp.join("omniterm-paste-notes.txt").exists());
}

#[test]
fn clear_without_a_temp_dir_leaves_legacy_files() {
    let temp = dir();
    fs::write(temp.path().join("omniterm-paste-1.png"), b"x").expect("legacy");
    let report = clear_attachments(&temp.path().join("none"), None);
    assert_eq!(report, ClearReport::default());
    assert!(temp.path().join("omniterm-paste-1.png").exists());
    assert!(legacy_pastes(&temp.path().join("nonexistent")).is_empty());
}

#[test]
fn percent_decode_round_trips_encode_uri_component() {
    assert_eq!(
        percent_decode("b%C3%A1o%20c%C3%A1o.pdf").as_deref(),
        Some("báo cáo.pdf")
    );
    assert_eq!(percent_decode("plain.txt").as_deref(), Some("plain.txt"));
    assert_eq!(percent_decode("bad%2"), None);
    assert_eq!(percent_decode("bad%zz"), None);
    assert_eq!(percent_decode("bad%+1"), None);
    assert_eq!(percent_decode("%FF"), None);
}

#[test]
fn imports_a_copied_file_and_refuses_folders_and_empty_files() {
    let temp = dir();
    let folder = temp.path().join("attachments");
    let source = temp.path().join("Quarterly report.pdf");
    fs::write(&source, b"%PDF-1.7").expect("write source");
    let imported = import_attachment(&folder, &source, 9).expect("import");
    assert_eq!(imported.name, "Quarterly report-9.pdf");
    assert_eq!(fs::read(&imported.path).expect("read copy"), b"%PDF-1.7");
    assert!(source.exists(), "the original is copied, never moved");

    let folder_error = import_attachment(&folder, temp.path(), 9).expect_err("folder");
    assert_eq!(folder_error.kind(), io::ErrorKind::InvalidInput);
    let empty = temp.path().join("empty.txt");
    fs::write(&empty, b"").expect("write empty");
    assert!(import_attachment(&folder, &empty, 9).is_err());

    let huge = temp.path().join("huge.bin");
    let huge_file = fs::File::create(&huge).expect("create huge");
    huge_file
        .set_len((MAX_ATTACHMENT_BYTES + 1) as u64)
        .expect("set_len");
    let oversized = import_attachment(&folder, &huge, 9).expect_err("oversized");
    assert_eq!(oversized.kind(), io::ErrorKind::InvalidInput);
}

fn drop_files_block(names: &[&str], wide: bool) -> Vec<u8> {
    let mut block = Vec::new();
    block.extend_from_slice(&20u32.to_le_bytes());
    block.extend_from_slice(&[0u8; 12]);
    block.extend_from_slice(&u32::from(wide).to_le_bytes());
    for name in names {
        if wide {
            for unit in name.encode_utf16() {
                block.extend_from_slice(&unit.to_le_bytes());
            }
            block.extend_from_slice(&[0, 0]);
        } else {
            block.extend_from_slice(name.as_bytes());
            block.push(0);
        }
    }
    block.extend_from_slice(if wide { &[0, 0] } else { &[0] });
    block
}

#[test]
fn parses_explorer_drop_files_blocks() {
    let wide = drop_files_block(&[r"C:\Users\me\báo cáo.pdf", r"D:\shot.png"], true);
    assert_eq!(
        parse_drop_files(&wide),
        [
            PathBuf::from(r"C:\Users\me\báo cáo.pdf"),
            PathBuf::from(r"D:\shot.png")
        ]
    );
    let narrow = drop_files_block(&[r"C:\a.txt"], false);
    assert_eq!(parse_drop_files(&narrow), [PathBuf::from(r"C:\a.txt")]);
}

#[test]
fn ignores_malformed_drop_files_blocks() {
    assert!(parse_drop_files(&[]).is_empty());
    assert!(parse_drop_files(&[1, 2, 3]).is_empty());
    let mut out_of_range = drop_files_block(&[r"C:\a.txt"], true);
    out_of_range[0] = 250;
    assert!(parse_drop_files(&out_of_range).is_empty());
}
