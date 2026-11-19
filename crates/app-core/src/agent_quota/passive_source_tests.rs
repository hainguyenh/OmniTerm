use super::super::agy_bridge::agy_cli_dir;
use super::super::claude_bridge_install::remove_bridge;
use super::super::fake_deps::FakeDeps;
use super::*;

fn request(agent: AgentKind, dir: Option<&Path>, launcher: Option<&str>) -> FetchUsageRequest {
    FetchUsageRequest {
        agent,
        profile_dir: dir.map(Path::to_path_buf),
        launcher: launcher.map(str::to_string),
        model_family: None,
        model_family_auto: false,
        max_record_age_ms: None,
    }
}

fn target<'a>(exe: &'a Path, settings: &'a Path) -> BridgeTarget<'a> {
    BridgeTarget {
        exe,
        app_settings: settings,
        platform: Platform::Unix,
    }
}

#[test]
fn installs_the_claude_bridge_once_and_then_reports_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    let exe = Path::new("/opt/omniterm");
    let settings = dir.path().join("app.json");
    let deps = FakeDeps::new(&[]);
    let claude = request(AgentKind::Claude, Some(dir.path()), None);
    assert!(ensure_passive_source(
        &claude,
        &target(exe, &settings),
        &deps
    ));
    assert!(dir.path().join("settings.json").exists());
    assert!(ensure_passive_source(
        &claude,
        &target(exe, &settings),
        &deps
    ));
}

#[test]
fn a_removed_or_unreadable_bridge_stays_out_and_falls_back() {
    let dir = tempfile::tempdir().expect("temp dir");
    let exe = Path::new("/opt/omniterm");
    let settings = dir.path().join("app.json");
    let deps = FakeDeps::new(&[]);
    let claude = request(AgentKind::Claude, Some(dir.path()), None);
    assert!(ensure_passive_source(
        &claude,
        &target(exe, &settings),
        &deps
    ));
    remove_bridge(dir.path(), exe, Platform::Unix).expect("remove");
    assert!(!ensure_passive_source(
        &claude,
        &target(exe, &settings),
        &deps
    ));
    assert!(
        !std::fs::read_to_string(dir.path().join("settings.json"))
            .expect("read")
            .contains("omniterm-claude"),
        "not put back by itself"
    );

    let broken = tempfile::tempdir().expect("temp dir");
    std::fs::write(broken.path().join("settings.json"), "{").expect("write");
    let claude = request(AgentKind::Claude, Some(broken.path()), None);
    assert!(!ensure_passive_source(
        &claude,
        &target(exe, &settings),
        &deps
    ));
}

#[test]
fn installs_the_antigravity_bridge_in_its_cli_folder() {
    let home = tempfile::tempdir().expect("temp dir");
    let exe = Path::new("/opt/omniterm");
    let settings = home.path().join("app.json");
    let deps = FakeDeps::new(&[]);
    let agy = request(AgentKind::Agy, Some(home.path()), None);
    assert!(ensure_passive_source(&agy, &target(exe, &settings), &deps));
    assert!(agy_cli_dir(home.path()).join("settings.json").exists());
}

#[test]
fn a_launcher_without_a_folder_and_codex_without_a_log_are_not_passive() {
    let exe = Path::new("/opt/omniterm");
    let settings = Path::new("/tmp/app.json");
    let deps = FakeDeps::new(&[]);
    for agent in [AgentKind::Claude, AgentKind::Agy] {
        let named = request(agent, None, Some("x-work"));
        assert!(!ensure_passive_source(
            &named,
            &target(exe, settings),
            &deps
        ));
    }
    let codex = request(AgentKind::Codex, None, None);
    assert!(!ensure_passive_source(
        &codex,
        &target(exe, settings),
        &deps
    ));
}
