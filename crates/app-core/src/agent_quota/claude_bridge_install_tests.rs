use serde_json::json;

use super::*;

fn exe() -> PathBuf {
    PathBuf::from("C:/Program Files/OmniTerm/omniterm.exe")
}

fn app_settings(dir: &Path) -> PathBuf {
    dir.join("app").join("settings.json")
}

fn settings(dir: &Path) -> Value {
    let text = std::fs::read_to_string(dir.join("settings.json")).expect("settings.json");
    serde_json::from_str(&text).expect("valid JSON")
}

fn write(dir: &Path, value: &str) {
    std::fs::write(dir.join("settings.json"), value).expect("write settings.json");
}

fn install(dir: &Path) -> BridgeStatus {
    install_bridge(dir, &exe(), &app_settings(dir), Platform::Windows).expect("install")
}

#[test]
fn builds_one_command_that_runs_in_git_bash_and_powershell() {
    let command = shell_command(
        Path::new(r"C:\Program Files\O'T\omniterm.exe"),
        &["--a", "C:/p"],
        Platform::Windows,
    );
    assert_eq!(
        command.as_deref(),
        Some("powershell -NoProfile -NonInteractive -Command \"& 'C:/Program Files/O''T/omniterm.exe' '--a' 'C:/p' | Write-Output\"")
    );
    for refused in ["C:/a$b/x.exe", "C:/a`b/x.exe", "C:/a\"b/x.exe"] {
        assert_eq!(
            shell_command(Path::new(refused), &[], Platform::Windows),
            None,
            "{refused}"
        );
    }
}

#[test]
fn quotes_only_what_sh_needs() {
    assert_eq!(
        shell_command(
            Path::new("/opt/omni term/omniterm"),
            &["--a", "/home/me/.claude", "it's"],
            Platform::Unix
        )
        .as_deref(),
        Some("'/opt/omni term/omniterm' --a /home/me/.claude 'it'\\''s'")
    );
}

#[test]
fn installs_into_a_profile_without_settings() {
    let dir = tempfile::tempdir().expect("temp dir");
    let status = install(dir.path());
    assert_eq!(
        status,
        BridgeStatus {
            installed: true,
            current: true,
            wraps_status_line: false,
            unreadable: false
        }
    );
    let doc = settings(dir.path());
    assert!(doc["statusLine"]["command"]
        .as_str()
        .is_some_and(|command| command.contains(STATUSLINE_FLAG)));
    let group = &doc["hooks"]["PreToolUse"][0];
    assert_eq!(group["matcher"], "Agent|Task");
    assert!(group["hooks"][0]["command"]
        .as_str()
        .is_some_and(|command| command.contains(GUARD_FLAG)));
    assert!(
        !dir.path()
            .join("omniterm")
            .join("settings.backup.json")
            .exists(),
        "nothing to back up"
    );
}

#[test]
fn wraps_the_earlier_status_line_keeps_other_settings_and_their_order() {
    let dir = tempfile::tempdir().expect("temp dir");
    let original = r#"{"zeta":1,"statusLine":{"type":"command","command":"mine","padding":2},"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint"}]}],"Stop":[]},"alpha":true}"#;
    write(dir.path(), original);
    let status = install(dir.path());
    assert!(status.wraps_status_line);
    let text = std::fs::read_to_string(dir.path().join("settings.json")).expect("read");
    let order: Vec<usize> = ["\"zeta\"", "\"statusLine\"", "\"hooks\"", "\"alpha\""]
        .iter()
        .map(|key| text.find(key).expect("key kept"))
        .collect();
    assert!(
        order.windows(2).all(|pair| pair[0] < pair[1]),
        "top-level order kept: {text}"
    );
    let doc = settings(dir.path());
    assert_eq!(doc["statusLine"]["padding"], 2);
    assert_eq!(
        doc["hooks"]["PreToolUse"][0]["matcher"], "Bash",
        "the user's own hook stays first"
    );
    assert_eq!(doc["hooks"]["Stop"], json!([]));
    let backup = std::fs::read_to_string(dir.path().join("omniterm").join("settings.backup.json"))
        .expect("backup");
    assert_eq!(backup, original);
    let bridge: Value =
        serde_json::from_str(&std::fs::read_to_string(bridge_file(dir.path())).expect("bridge"))
            .expect("JSON");
    assert_eq!(bridge["previousStatusLine"]["command"], "mine");
}

#[test]
fn reinstalling_is_idempotent_and_keeps_the_original_status_line() {
    let dir = tempfile::tempdir().expect("temp dir");
    write(
        dir.path(),
        r#"{"statusLine":{"type":"command","command":"mine"}}"#,
    );
    install(dir.path());
    install(dir.path());
    let doc = settings(dir.path());
    assert_eq!(
        doc["hooks"]["PreToolUse"].as_array().map(Vec::len),
        Some(1),
        "one guard only"
    );
    remove_bridge(dir.path(), &exe(), Platform::Windows).expect("remove");
    assert_eq!(
        settings(dir.path()),
        json!({ "statusLine": { "type": "command", "command": "mine" } })
    );
}

#[test]
fn reports_an_install_from_another_omniterm_as_not_current() {
    let dir = tempfile::tempdir().expect("temp dir");
    install(dir.path());
    let other = bridge_status(
        dir.path(),
        Path::new("D:/dev/omniterm.exe"),
        Platform::Windows,
    );
    assert_eq!(
        other,
        BridgeStatus {
            installed: true,
            current: false,
            wraps_status_line: false,
            unreadable: false
        }
    );
}

#[test]
fn removes_only_its_own_entries_and_files() {
    let dir = tempfile::tempdir().expect("temp dir");
    write(
        dir.path(),
        r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint"}]}]}}"#,
    );
    install(dir.path());
    std::fs::write(usage_file(dir.path()), "{}").expect("usage record");
    let status = remove_bridge(dir.path(), &exe(), Platform::Windows).expect("remove");
    assert!(!status.installed);
    assert_eq!(
        settings(dir.path()),
        json!({ "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "lint" }] }] } })
    );
    assert!(!bridge_file(dir.path()).exists());
    assert!(!usage_file(dir.path()).exists());
}

#[test]
fn drops_a_guard_that_shares_a_group_with_the_users_hook() {
    let groups = [json!({ "matcher": "Agent", "hooks": [
        { "type": "command", "command": "mine" },
        { "type": "command", "command": format!("x {GUARD_FLAG}") },
    ] })];
    assert_eq!(
        without_guard(&groups),
        [json!({ "matcher": "Agent", "hooks": [{ "type": "command", "command": "mine" }] })]
    );
}

#[test]
fn never_writes_a_settings_file_it_cannot_parse() {
    let dir = tempfile::tempdir().expect("temp dir");
    write(dir.path(), "{ broken");
    assert!(install_bridge(
        dir.path(),
        &exe(),
        &app_settings(dir.path()),
        Platform::Windows
    )
    .is_err());
    assert!(remove_bridge(dir.path(), &exe(), Platform::Windows).is_err());
    assert!(bridge_status(dir.path(), &exe(), Platform::Windows).unreadable);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("settings.json")).expect("read"),
        "{ broken"
    );
}

#[test]
fn removing_from_a_profile_without_settings_changes_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let status = remove_bridge(dir.path(), &exe(), Platform::Windows).expect("remove");
    assert!(!status.installed);
    assert!(!dir.path().join("settings.json").exists());
}

#[test]
fn accepts_only_absolute_profile_paths() {
    assert_eq!(bridge_profile_dir("relative/dir"), None);
    let absolute = if cfg!(windows) {
        "C:/Users/me/.claude"
    } else {
        "/home/me/.claude"
    };
    assert_eq!(bridge_profile_dir(absolute), Some(PathBuf::from(absolute)));
}
