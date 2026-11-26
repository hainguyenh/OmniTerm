use serde_json::Value;

use super::super::fake_deps::now;
use super::*;

fn exe() -> std::path::PathBuf {
    std::path::PathBuf::from("C:/Program Files/OmniTerm/omniterm.exe")
}

fn settings(home: &Path) -> Value {
    let text =
        std::fs::read_to_string(agy_cli_dir(home).join("settings.json")).expect("settings.json");
    serde_json::from_str(&text).expect("valid JSON")
}

fn write(home: &Path, text: &str) {
    let dir = agy_cli_dir(home);
    std::fs::create_dir_all(&dir).expect("cli dir");
    std::fs::write(dir.join("settings.json"), text).expect("write settings.json");
}

#[test]
fn installs_beside_the_built_in_line_when_there_was_none() {
    let home = tempfile::tempdir().expect("temp dir");
    let status = install_agy_bridge(home.path(), &exe(), Platform::Windows).expect("install");
    assert!(status.installed && status.current && !status.wraps_status_line);
    let doc = settings(home.path());
    assert!(doc["statusLine"]["command"]
        .as_str()
        .is_some_and(|command| command.contains(AGY_STATUSLINE_FLAG)));
    assert_eq!(doc["statusLine"]["stack_with_default"], true);
}

#[test]
fn wraps_and_restores_the_earlier_status_line() {
    let home = tempfile::tempdir().expect("temp dir");
    write(
        home.path(),
        r#"{"theme":"dark","statusLine":{"type":"command","command":"mine.sh","padding":1}}"#,
    );
    let status = install_agy_bridge(home.path(), &exe(), Platform::Unix).expect("install");
    assert!(status.wraps_status_line);
    let doc = settings(home.path());
    assert_eq!(doc["statusLine"]["padding"], 1);
    assert_eq!(doc["statusLine"].get("stack_with_default"), None);
    assert_eq!(doc["theme"], "dark");
    let again = install_agy_bridge(home.path(), &exe(), Platform::Unix).expect("reinstall");
    assert!(
        again.wraps_status_line,
        "a second install keeps the earlier line"
    );

    let removed = remove_agy_bridge(home.path(), &exe(), Platform::Unix).expect("remove");
    assert!(!removed.installed);
    assert_eq!(settings(home.path())["statusLine"]["command"], "mine.sh");
    assert!(agy_cli_dir(home.path())
        .join("omniterm")
        .join("bridge-declined")
        .exists());
}

#[test]
fn never_writes_an_unreadable_settings_file() {
    let home = tempfile::tempdir().expect("temp dir");
    write(home.path(), "{ not json");
    assert!(install_agy_bridge(home.path(), &exe(), Platform::Unix).is_err());
    assert!(agy_bridge_status(home.path(), &exe(), Platform::Unix).unreadable);
    let text =
        std::fs::read_to_string(agy_cli_dir(home.path()).join("settings.json")).expect("read");
    assert_eq!(text, "{ not json");
}

#[test]
fn another_copy_is_installed_but_not_current() {
    let home = tempfile::tempdir().expect("temp dir");
    install_agy_bridge(home.path(), &exe(), Platform::Unix).expect("install");
    let status = agy_bridge_status(home.path(), Path::new("/other/omniterm"), Platform::Unix);
    assert!(status.installed && !status.current);
}

#[test]
fn the_status_line_mode_stores_the_quota_and_chains_the_earlier_line() {
    let home = tempfile::tempdir().expect("temp dir");
    write(
        home.path(),
        r#"{"statusLine":{"type":"command","command":"mine.sh"}}"#,
    );
    install_agy_bridge(home.path(), &exe(), Platform::Unix).expect("install");
    let input = r#"{"quota":{"gemini-weekly":{"remaining_fraction":0.5}}}"#;
    let chained = agy_statusline_output(home.path(), input, now(), &|command, payload| {
        assert_eq!(command, "mine.sh");
        assert_eq!(payload, input);
        Some("mine\n".to_string())
    });
    assert_eq!(chained, "mine\n");
    assert!(agy_usage_file(home.path()).exists());

    let failed = agy_statusline_output(home.path(), input, now(), &|_, _| None);
    assert_eq!(
        failed, "Quota 5h 0% · wk 50%\n",
        "a failed chain shows our own line"
    );
}

#[test]
fn cmd_cannot_carry_a_percent_sign() {
    let home = Path::new("C:/Users/a%PATH%b/.gemini");
    assert!(install_agy_bridge(home, &exe(), Platform::Windows).is_err());
}
