use std::path::PathBuf;

use super::super::fake_deps::{home, FakeDeps};
use super::*;

#[test]
fn accepts_only_this_agents_launcher_names() {
    for (name, agent) in [
        ("claude-work", AgentKind::Claude),
        ("claude-a_b.c", AgentKind::Claude),
        ("codex-x", AgentKind::Codex),
        ("agy-work", AgentKind::Agy),
    ] {
        assert!(is_launcher_name(name, agent), "{name}");
    }
    let too_long = format!("claude-{}", "a".repeat(41));
    for (name, agent) in [
        ("agy-gemini", AgentKind::Agy),
        ("claude-", AgentKind::Claude),
        (too_long.as_str(), AgentKind::Claude),
        ("claude-a-b", AgentKind::Claude),
        ("claudework", AgentKind::Claude),
        ("codex-x", AgentKind::Claude),
    ] {
        assert!(!is_launcher_name(name, agent), "{name}");
    }
    assert!(is_profile_suffix(&"a".repeat(40)));
}

#[test]
fn accepts_prompts_with_digits_and_plain_punctuation() {
    for prompt in ["hi 2", "Ready? 'Yes', go-ahead.", "42"] {
        assert!(is_safe_prompt(prompt), "{prompt}");
    }
    for prompt in ["a;b", "a/b", "a\tb"] {
        assert!(!is_safe_prompt(prompt), "{prompt}");
    }
}

#[test]
fn falls_back_to_the_agent_cli_when_the_launcher_cannot_be_resolved() {
    let deps = FakeDeps::new(&[])
        .resolving("claude.exe")
        .with_env(&[("CLAUDE_CONFIG_DIR", "stale"), ("PATH", "p")]);
    let command = agent_command(
        AgentKind::Claude,
        Some(&home().join("work")),
        Some("claude-work"),
        &deps,
    )
    .expect("the agent CLI");
    assert_eq!(command.exe, PathBuf::from("claude.exe"));
    assert_eq!(
        command
            .env
            .get(std::ffi::OsStr::new("CLAUDE_CONFIG_DIR"))
            .map(|value| value.to_string_lossy().into_owned()),
        Some(home().join("work").to_string_lossy().into_owned())
    );
    assert_eq!(
        *deps.launcher_lookups.lock().expect("lookups lock"),
        ["claude-work"]
    );
    // An invalid launcher name is never looked up.
    let unchecked = FakeDeps::new(&[]);
    assert_eq!(
        agent_command(AgentKind::Claude, None, Some("../x"), &unchecked),
        None
    );
    assert!(unchecked
        .launcher_lookups
        .lock()
        .expect("lookups lock")
        .is_empty());
}
