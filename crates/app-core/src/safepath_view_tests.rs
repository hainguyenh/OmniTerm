// Viewer-specific tests for `safepath`.

// ── The viewer's deny-list gate ──────────────────────────────────────────
/// The feature: text files the *editor* refuses are still readable by the viewer. Before this,
/// `notes.txt` and every other non-script file rendered as "content not available".
///
/// `.rdp` is in here too — it is text, and naming the host a double-click would connect to is the
/// whole point of viewing one. Both must stay unsaveable: widening the view gate must not widen write.
#[test]
fn views_non_editable_text_files_without_making_them_saveable() {
    let f = fixture();
    for (name, body) in [("notes.txt", "just notes"), ("host.rdp", "full address:s:server01")] {
        let path = f.root.join(name);
        fs::write(&path, body).unwrap();
        assert_eq!(read(&f, &path).unwrap(), body, "{name} should be viewable");
        assert!(
            safe_editable_path(&root_str(&f), &path.to_string_lossy()).is_err(),
            "{name} must not be saveable"
        );
    }
}

/// An unlisted text extension and an extensionless name both open, which is the reason this is a
/// deny-list: neither `.hcl` nor `Dockerfile` should need a code change to be readable.
#[test]
fn views_unlisted_and_extensionless_text_files() {
    let f = fixture();
    for (name, body) in [("main.hcl", "resource {}"), ("Dockerfile", "FROM scratch")] {
        let path = f.root.join(name);
        fs::write(&path, body).unwrap();
        assert_eq!(read(&f, &path).unwrap(), body, "{name} should be viewable");
    }
}

/// Denied kinds are refused on extension, before anything is read. Every file here is written with
/// plausible *text* content, so only the deny-list can be what rejects it.
///
/// The key-material half is the regression guard that matters: `.pem`/`.key`/`.ppk` really are text,
/// so no content sniff would ever catch them, and dropping those entries silently turns this viewer
/// into a private-key display.
#[test]
fn refuses_denied_kinds_without_reading_them() {
    let f = fixture();
    let denied = [
        "payload.exe", "lib.dll", "bundle.zip", "photo.png", "notes.pdf", // binary containers
        "id.pem", "server.key", "client.pfx", "putty.ppk", "sig.asc",     // key material
    ];
    for name in denied {
        let path = f.root.join(name);
        fs::write(&path, "-----BEGIN PRIVATE KEY-----").unwrap();
        let err = read(&f, &path).expect_err("must refuse a denied kind");
        assert!(err.contains("cannot be viewed as text"), "{name}: got {err}");
    }
}

/// The content-level backstop, for what no extension rule can catch: a binary wearing `.log`, and
/// text in a legacy code page. Two distinct messages, because they are two distinct situations.
#[test]
fn refuses_content_that_is_not_utf8_text() {
    let f = fixture();
    let cases: [(&str, &[u8], &str); 2] = [
        ("core.log", &[0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01], "binary"),
        // Latin-1 "café" — no NUL, but not valid UTF-8 either.
        ("legacy.txt", &[b'c', b'a', b'f', 0xe9], "UTF-8"),
    ];
    for (name, bytes, expected) in cases {
        let path = f.root.join(name);
        fs::write(&path, bytes).unwrap();
        let err = read(&f, &path).expect_err("must refuse non-text content");
        assert!(err.contains(expected), "{name}: got {err}");
    }
}

/// A NUL past the sniff window is not worth reading the whole file for; the file still decodes,
/// so the user sees their text rather than a refusal. Pins the bounded-sniff decision.
#[test]
fn a_nul_past_the_sniff_window_does_not_refuse_the_file() {
    let f = fixture();
    let path = f.root.join("long.log");
    let mut bytes = vec![b'a'; SNIFF_BYTES + 16];
    bytes[SNIFF_BYTES + 8] = 0;
    fs::write(&path, &bytes).unwrap();
    // Invalid-UTF-8 rejection does not apply — a NUL is valid UTF-8 — so this reads through.
    assert!(read(&f, &path).is_ok());
}

/// A BOM must survive the round trip: it is how `powershell.exe` detects a script's encoding.
#[test]
fn preserves_a_utf8_bom_through_read_and_write() {
    let f = fixture();
    let path = f.root.join("bom.ps1");
    fs::write(&path, "\u{feff}Write-Host hi").unwrap();
    let text = read(&f, &path).unwrap();
    assert!(text.starts_with('\u{feff}'), "BOM was stripped on read");
    write(&f, &path, &text).unwrap();
    assert_eq!(fs::read(&path).unwrap()[..3], [0xef, 0xbb, 0xbf]);
}

/// Containment still applies to the viewer — the wider gate must not become a read-anything hole.
#[test]
fn viewer_still_refuses_a_file_outside_the_workspace() {
    let f = fixture();
    let escape = f.outside.join("secret.bat");
    let err = read(&f, &escape).expect_err("must refuse outside the workspace");
    assert!(err.contains("outside its workspace"), "got {err}");
    let traversal = f.root.join("..").join("outside").join("secret.bat");
    assert!(read(&f, &traversal).is_err());
}

#[test]
fn viewer_reports_the_size_limit_it_enforced() {
    let f = fixture();
    let path = f.root.join("big.txt");
    fs::write(&path, "x".repeat(3 * 1024 * 1024)).unwrap();
    // Default cap refuses it, and the message names both sizes so the setting is actionable.
    let err = read(&f, &path).expect_err("must refuse an oversized file");
    assert!(err.contains("3.0 MB") && err.contains("1.0 MB"), "got {err}");
    // Raising the cap opens the same file — the point of making it a setting.
    assert!(read_viewable(&root_str(&f), &path.to_string_lossy(), 4 * 1024 * 1024).is_ok());
}

#[test]
fn clamps_a_configured_cap_into_the_supported_range() {
    assert_eq!(clamp_max_bytes(None), DEFAULT_MAX_VIEW_BYTES);
    assert_eq!(clamp_max_bytes(Some(0)), DEFAULT_MAX_VIEW_BYTES);
    assert_eq!(clamp_max_bytes(Some(2 * 1024 * 1024)), 2 * 1024 * 1024);
    assert_eq!(clamp_max_bytes(Some(u64::MAX)), MAX_VIEW_BYTES_CEILING);
}

/// The two gates answer different questions and must not drift into each other.
#[test]
fn viewable_and_editable_gates_stay_distinct() {
    for ext in EDITABLE_EXTS {
        assert!(is_viewable_kind_excluding(ext, &[]), "{ext} is editable so must be viewable");
    }
    for &ext in VIEW_DENY_EXTS {
        assert!(
            !EDITABLE_EXTS.contains(&ext),
            "{ext} is denied for viewing but listed as editable"
        );
    }
}

// ── User-configurable exclusions ("Excluded file types" in Settings) ────

/// The user's list narrows the viewer, on top of the fixed deny-list, and is case-insensitive —
/// the settings UI stores whatever case the user typed a custom extension in.
#[test]
fn user_excluded_extensions_narrow_the_viewer() {
    let excluded = vec!["MD".to_string(), "log".to_string()];
    assert!(!is_viewable_kind_excluding("md", &excluded));
    assert!(!is_viewable_kind_excluding("LOG", &excluded));
    assert!(is_viewable_kind_excluding("txt", &excluded), "unaffected extensions stay viewable");
}

/// A user exclusion cannot widen the viewer past `VIEW_DENY_EXTS` — an empty (or irrelevant)
/// exclusion list must behave exactly like the base check.
#[test]
fn user_exclusions_never_widen_the_fixed_deny_list() {
    for &ext in VIEW_DENY_EXTS {
        assert!(!is_viewable_kind_excluding(ext, &["something-else".to_string()]));
    }
}

/// The deny-list is never empty in production: only the app's built-in entries gate the
/// viewer, since the user can only add to the list, never remove from it. The equality
/// contract between this list and the `system_excluded_view_exts` command the Settings UI
/// calls is asserted in the desktop adapter (`safepath_command` tests).
#[test]
fn view_deny_list_is_non_empty() {
    assert!(
        !VIEW_DENY_EXTS.is_empty(),
        "the deny-list is non-empty in production"
    );
}

#[test]
fn read_viewable_excluding_refuses_a_user_excluded_extension() {
    let f = fixture();
    let path = f.root.join("notes.txt");
    fs::write(&path, "hello").unwrap();
    let excluded = vec!["txt".to_string()];
    let err = read_viewable_excluding(&root_str(&f), &path.to_string_lossy(), DEFAULT_MAX_VIEW_BYTES, &excluded)
        .expect_err("must refuse a user-excluded extension");
    assert!(err.contains("cannot be viewed as text"), "got {err}");
    // Unaffected by the exclusion list read without it.
    assert_eq!(read(&f, &path).unwrap(), "hello");
}

