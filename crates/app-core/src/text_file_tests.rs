//! Tests for `text_file`: line statistics, the open path (BOM, EOL, refusals) and the save path
//! (conflicts, forced writes, atomic replace, refusals).

use super::*;

const MAX: u64 = 1024 * 1024;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    outside: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-text-file")
        .tempdir()
        .expect("temp dir");
    let base = dunce::canonicalize(dir.path()).expect("canonical base");
    let root = base.join("workspace");
    let outside = base.join("outside");
    fs::create_dir_all(root.join("sub")).expect("create workspace");
    fs::create_dir_all(&outside).expect("create outside dir");
    Fixture {
        _dir: dir,
        root,
        outside,
    }
}

impl Fixture {
    fn root(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn write(&self, rel: &str, bytes: &[u8]) {
        fs::write(self.root.join(rel), bytes).expect("write fixture file");
    }

    fn read(&self, rel: &str) -> Vec<u8> {
        fs::read(self.root.join(rel)).expect("read fixture file")
    }

    fn open(&self, rel: &str) -> Result<TextFileContent, String> {
        open_text_file(&self.root(), rel, MAX, &[])
    }

    fn save(
        &self,
        rel: &str,
        request: &TextFileSaveRequest,
    ) -> Result<TextFileSaveOutcome, String> {
        save_text_file(&self.root(), rel, request, MAX, &[])
    }
}

fn request(content: &str) -> TextFileSaveRequest {
    TextFileSaveRequest {
        content: content.to_string(),
        bom: false,
        expected_mtime_ms: None,
        expected_size: None,
        force: false,
    }
}

fn saved(outcome: TextFileSaveOutcome) -> (u64, u64) {
    match outcome {
        TextFileSaveOutcome::Saved { size, mtime_ms } => (size, mtime_ms),
        other => panic!("expected a save, got {other:?}"),
    }
}

#[test]
fn measure_counts_lines_lengths_and_endings() {
    assert_eq!(
        measure(""),
        TextStats {
            line_count: 1,
            ..TextStats::default()
        }
    );
    let stats = measure("ab\r\nc\nxyz\rñññññ");
    assert_eq!(stats.line_count, 4);
    assert_eq!(stats.max_line_len, 5, "multi-byte characters count once");
    assert_eq!((stats.crlf, stats.lf, stats.cr), (1, 1, 1));
    assert_eq!(measure("abc\n").line_count, 2);
}

#[test]
fn dominant_eol_prefers_the_majority_and_flags_mixed_files() {
    let crlf = measure("a\r\nb\r\nc\n");
    assert_eq!(dominant_eol(&crlf), TextEol::Crlf);
    assert!(is_mixed(&crlf));
    let lf = measure("a\nb\n");
    assert_eq!(dominant_eol(&lf), TextEol::Lf);
    assert!(!is_mixed(&lf));
    let none = measure("single line");
    let platform = if cfg!(windows) {
        TextEol::Crlf
    } else {
        TextEol::Lf
    };
    assert_eq!(dominant_eol(&none), platform);
}

#[test]
fn opens_text_with_stats_and_strips_the_bom() {
    let f = fixture();
    f.write("a.ps1", b"\xEF\xBB\xBFWrite-Host 1\r\nexit\r\n");
    let opened = f.open("a.ps1").expect("open BOM file");
    assert!(opened.has_bom);
    assert_eq!(opened.content, "Write-Host 1\r\nexit\r\n");
    assert_eq!(opened.size, 23);
    assert_eq!(opened.eol, TextEol::Crlf);
    assert!(!opened.mixed_eol);
    assert_eq!(opened.line_count, 3);
    assert_eq!(opened.max_line_len, 12);
    assert!(opened.mtime_ms > 0);
    assert!(!opened.read_only);

    f.write("data.json", b"{}");
    assert!(!f.open("data.json").expect("open json").has_bom);
}

#[test]
fn open_refuses_binary_invalid_utf8_large_and_denied_files() {
    let f = fixture();
    f.write("blob.txt", b"ab\0cd");
    assert!(f.open("blob.txt").expect_err("binary").contains("binary"));
    f.write("latin1.txt", b"caf\xE9");
    assert!(f.open("latin1.txt").expect_err("latin1").contains("UTF-8"));
    f.write("id.pem", b"-----BEGIN-----");
    assert!(
        f.open("id.pem").is_err(),
        "key material stays out of the editor"
    );
    f.write("big.log", &vec![b'x'; 2048]);
    let err = open_text_file(&f.root(), "big.log", 1024, &[]).expect_err("too large");
    assert!(err.contains("Max file size to open"));
    f.write("notes.md", b"# hi");
    let excluded = vec!["md".to_string()];
    assert!(open_text_file(&f.root(), "notes.md", MAX, &excluded).is_err());
    assert!(f.open("sub").is_err(), "a directory is not a file");
}

#[test]
fn open_refuses_paths_outside_the_workspace() {
    let f = fixture();
    fs::write(f.outside.join("secret.txt"), b"secret").expect("write outside");
    let outside = f.outside.join("secret.txt");
    assert!(f.open(&outside.to_string_lossy()).is_err());
    assert!(f.open("../outside/secret.txt").is_err());
}

#[test]
fn saves_any_text_file_and_reports_the_new_version() {
    let f = fixture();
    f.write("app.ts", b"let a = 1\n");
    let opened = f.open("app.ts").expect("open ts");
    let mut req = request("let a = 2\n");
    req.expected_mtime_ms = Some(opened.mtime_ms);
    req.expected_size = Some(opened.size);
    let (size, mtime) = saved(f.save("app.ts", &req).expect("save ts"));
    assert_eq!(size, 10);
    assert!(mtime > 0);
    assert_eq!(f.read("app.ts"), b"let a = 2\n");
    let leftovers: Vec<_> = fs::read_dir(&f.root)
        .expect("list root")
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".omniterm-tmp"))
        .collect();
    assert!(leftovers.is_empty(), "the temp file is renamed away");
}

#[test]
fn save_writes_the_bom_back_and_counts_it_against_the_limit() {
    let f = fixture();
    f.write("a.ps1", b"\xEF\xBB\xBFold");
    let mut req = request("new");
    req.bom = true;
    saved(f.save("a.ps1", &req).expect("save with BOM"));
    assert_eq!(f.read("a.ps1"), b"\xEF\xBB\xBFnew");
    let err = save_text_file(&f.root(), "a.ps1", &req, 5, &[]).expect_err("BOM pushes over");
    assert!(err.contains("save limit"));
}

#[test]
fn save_reports_a_conflict_when_the_file_changed_on_disk() {
    let f = fixture();
    f.write("conf.toml", b"a = 1");
    let opened = f.open("conf.toml").expect("open toml");
    f.write("conf.toml", b"a = 22");
    let mut req = request("a = 3");
    req.expected_mtime_ms = Some(opened.mtime_ms);
    req.expected_size = Some(opened.size);
    match f.save("conf.toml", &req).expect("save attempt") {
        TextFileSaveOutcome::Conflict {
            reason: ConflictReason::Modified,
            disk_mtime_ms: Some(_),
        } => {}
        other => panic!("expected a modified conflict, got {other:?}"),
    }
    assert_eq!(f.read("conf.toml"), b"a = 22", "the disk copy is untouched");
    req.force = true;
    saved(f.save("conf.toml", &req).expect("forced save"));
    assert_eq!(f.read("conf.toml"), b"a = 3");
}

#[test]
fn save_reports_a_deleted_file_and_recreates_it_when_forced() {
    let f = fixture();
    let mut req = request("hello");
    match f.save("sub/gone.md", &req).expect("save attempt") {
        TextFileSaveOutcome::Conflict {
            reason: ConflictReason::Deleted,
            disk_mtime_ms: None,
        } => {}
        other => panic!("expected a deleted conflict, got {other:?}"),
    }
    assert!(!f.root.join("sub/gone.md").exists());
    req.force = true;
    saved(f.save("sub/gone.md", &req).expect("forced recreate"));
    assert_eq!(f.read("sub/gone.md"), b"hello");
    saved(f.save("top.md", &req).expect("recreate at the root"));
}

#[test]
fn recreating_a_missing_file_stays_inside_the_workspace() {
    let f = fixture();
    let mut req = request("x");
    req.force = true;
    assert!(f.save("../outside/new.txt", &req).is_err());
    let absolute = f.outside.join("new.txt");
    assert!(f.save(&absolute.to_string_lossy(), &req).is_err());
    assert!(f.save("missing-dir/new.txt", &req).is_err());
    assert!(
        f.save("sub/new.pem", &req).is_err(),
        "denied kinds stay denied"
    );
    assert!(missing_target(&f.root(), "sub/..", &[]).is_err());
    assert!(!f.outside.join("new.txt").exists());
}

#[test]
fn save_refuses_binary_read_only_large_and_non_file_targets() {
    let f = fixture();
    f.write("blob.txt", b"ab\0cd");
    let req = request("text");
    assert!(f
        .save("blob.txt", &req)
        .expect_err("binary")
        .contains("binary"));
    assert!(f.save("sub", &req).is_err(), "a directory is not a file");
    f.write("big.txt", b"x");
    let err = save_text_file(&f.root(), "big.txt", &request("0123456789"), 4, &[])
        .expect_err("too large");
    assert!(err.contains("save limit"));

    f.write("locked.txt", b"old");
    let path = f.root.join("locked.txt");
    let mut permissions = fs::metadata(&path).expect("stat").permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions.clone()).expect("mark read-only");
    assert!(f.open("locked.txt").expect("open read-only").read_only);
    assert!(f
        .save("locked.txt", &req)
        .expect_err("read-only")
        .contains("read-only"));
    #[allow(clippy::permissions_set_readonly_false)]
    // Test cleanup only: tempdir removal needs the file writable again on Windows.
    permissions.set_readonly(false);
    fs::set_permissions(&path, permissions).expect("restore permissions");
}

#[cfg(unix)]
#[test]
fn save_keeps_the_executable_bit() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture();
    f.write("run.sh", b"echo 1");
    let path = f.root.join("run.sh");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
    saved(f.save("run.sh", &request("echo 2")).expect("save script"));
    let mode = fs::metadata(&path).expect("stat").permissions().mode();
    assert_eq!(mode & 0o777, 0o755);
}
