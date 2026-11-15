use std::io;
use std::path::PathBuf;

use super::super::fake_deps::{home, FakeDeps};
use super::*;

fn bin() -> PathBuf {
    home().join(".local").join("bin")
}

fn tools() -> PathBuf {
    home().join("tools")
}

fn profile(name: &str, dir: Option<PathBuf>, launcher: Option<&str>) -> DiscoveredProfile {
    DiscoveredProfile {
        agent: AgentKind::Claude,
        profile_name: name.to_string(),
        profile_dir: dir,
        launcher: launcher.map(str::to_string),
    }
}

#[test]
fn lists_existing_default_profiles_then_runnable_launchers_from_local_bin_and_path() {
    let files = [
        (home().join(".claude").join("settings.json"), "{}"),
        (bin().join("claude-work.cmd"), ""),
        (bin().join("claude.exe"), ""),
        (tools().join("claude-th.CMD"), ""),
        (tools().join("claude-WORK.bat"), ""),
        (tools().join("codex-alt.exe"), ""),
        (tools().join("claude-notes.ps1"), ""),
        (tools().join("claude-bad name.cmd"), ""),
        (tools().join("readme.txt"), ""),
    ];
    let path = format!("{0};{0};", tools().display());
    let claude_home = home().join(".claude");
    let codex_home = home().join(".codex");
    // A codex home and launcher exist too; only Claude profiles are supported for now.
    let deps = FakeDeps::new(&files)
        .with_env(&[("PATH", &path)])
        .with_mtime(move |file| Ok((file == claude_home || file == codex_home).then_some(1)));
    assert_eq!(
        list_profiles(&deps, Platform::Windows),
        vec![
            profile("claude", Some(home().join(".claude")), None),
            profile("claude-th", None, Some("claude-th")),
            profile("claude-work", None, Some("claude-work")),
        ]
    );
}

#[test]
fn takes_extensionless_launchers_on_unix_case_sensitively() {
    let files = [
        (bin().join("claude-work"), ""),
        (bin().join("claude-Work"), ""),
        (bin().join("claude-work.sh"), ""),
    ];
    let deps = FakeDeps::new(&files);
    let launchers: Vec<Option<String>> = list_profiles(&deps, Platform::Unix)
        .into_iter()
        .map(|p| p.launcher)
        .collect();
    assert_eq!(
        launchers,
        [
            Some("claude-Work".to_string()),
            Some("claude-work".to_string()),
            Some("claude-work.sh".to_string())
        ]
    );
}

#[test]
fn skips_unreadable_directories_instead_of_failing_the_listing() {
    let tools_dir = tools();
    let bin_dir = bin();
    let path = tools().display().to_string();
    let deps = FakeDeps::new(&[])
        .with_env(&[("PATH", &path)])
        .listing(move |dir| {
            if dir == tools_dir {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
            }
            Ok(if dir == bin_dir {
                vec!["claude-a.cmd".to_string()]
            } else {
                Vec::new()
            })
        })
        .with_mtime(|_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied")));
    assert_eq!(
        list_profiles(&deps, Platform::Windows),
        vec![profile("claude-a", None, Some("claude-a"))]
    );
}

#[test]
fn caps_the_listing() {
    let names: Vec<String> = (0..80)
        .map(|index| format!("claude-p{index:02}.cmd"))
        .collect();
    let bin_dir = bin();
    let deps = FakeDeps::new(&[]).listing(move |dir| {
        Ok(if dir == bin_dir {
            names.clone()
        } else {
            Vec::new()
        })
    });
    assert_eq!(list_profiles(&deps, Platform::Windows).len(), 50);
}

#[test]
fn discovers_custom_profiles_from_dot_claude_dirs_and_claude_profiles_subdirectories() {
    let files = [
        (home().join(".claude-custom").join("settings.json"), "{}"),
        (
            home()
                .join("claude-profiles")
                .join("team")
                .join("settings.json"),
            "{}",
        ),
        (
            home()
                .join("claude-profiles")
                .join("claude-work")
                .join("settings.json"),
            "{}",
        ),
    ];
    let deps = FakeDeps::new(&files)
        .with_mtime(|file| Ok(file.to_string_lossy().contains("claude").then_some(1)));
    let profiles = list_profiles(&deps, Platform::Windows);
    assert!(profiles.contains(&profile(
        "claude-custom",
        Some(home().join(".claude-custom")),
        None
    )));
    assert!(profiles.contains(&profile(
        "claude-team",
        Some(home().join("claude-profiles").join("team")),
        None
    )));
    assert!(profiles.contains(&profile(
        "claude-work",
        Some(home().join("claude-profiles").join("claude-work")),
        None
    )));
}

#[test]
fn fills_a_launchers_missing_directory_from_its_profile_folder() {
    let files = [
        (bin().join("claude-work.cmd"), ""),
        (home().join(".claude-work").join("settings.json"), "{}"),
    ];
    let work = home().join(".claude-work");
    let deps = FakeDeps::new(&files).with_mtime(move |file| Ok((file == work).then_some(1)));
    assert_eq!(
        list_profiles(&deps, Platform::Windows),
        vec![profile(
            "claude-work",
            Some(home().join(".claude-work")),
            Some("claude-work")
        )]
    );
}
