//! Antigravity (`agy`) detection, quoted launcher tokens and launcher names found on the agent's
//! own command line.

use super::*;

fn row(pid: u32, parent: u32, start_time: u64, image: &str, cmd: &[&str]) -> ProcRow {
    ProcRow {
        pid,
        parent,
        start_time,
        image: image.to_string(),
        cmd: cmd.iter().map(|arg| arg.to_string()).collect(),
        env: Vec::new(),
    }
}

const SHELL: u32 = 100;

#[test]
fn agy_is_recognised_by_image_and_by_its_packaged_cli() {
    assert_eq!(
        classify(&row(2, 0, 0, "agy.exe", &["agy"])),
        Some(AgentKind::Agy)
    );
    assert_eq!(
        classify(&row(3, 0, 0, "agy-preview", &["agy-preview"])),
        Some(AgentKind::Agy)
    );
    let packaged = row(
        4,
        0,
        0,
        "node",
        &["node", "/usr/lib/node_modules/antigravity-cli/bin/agy.js"],
    );
    assert_eq!(classify(&packaged), Some(AgentKind::Agy));
    let plain = row(5, 0, 0, "bun", &["bun", "run", "build.ts"]);
    assert_eq!(classify(&plain), None);
}

#[test]
fn agy_profiles_named_after_its_default_folders_read_as_agy() {
    assert_eq!(
        profile_name(AgentKind::Agy, Some("/home/me/.gemini")),
        "agy"
    );
    assert_eq!(
        profile_name(AgentKind::Agy, Some("/home/me/antigravity-cli/")),
        "agy"
    );
    assert_eq!(
        profile_name(AgentKind::Agy, Some("/home/me/.agy-work")),
        "agy-work"
    );
    assert_eq!(
        profile_name(AgentKind::Codex, Some("/home/me/.gemini")),
        "gemini"
    );
}

#[test]
fn launcher_names_accept_dotted_and_underscored_suffixes_but_not_agy_gemini() {
    assert_eq!(
        launcher_name("agy-work.cmd", AgentKind::Agy),
        Some("agy-work".to_string())
    );
    assert_eq!(launcher_name("agy-gemini.cmd", AgentKind::Agy), None);
    assert_eq!(
        launcher_name("claude-my_th.sh", AgentKind::Claude),
        Some("claude-my_th".to_string())
    );
    assert_eq!(
        launcher_name("claude-v1.2.cmd", AgentKind::Claude),
        Some("claude-v1.2".to_string())
    );
    assert_eq!(launcher_name("claude-a b.cmd", AgentKind::Claude), None);
}

#[test]
fn a_launcher_on_the_agents_own_command_line_names_the_profile() {
    let rows = vec![
        row(SHELL, 1, 10, "bash", &["bash"]),
        row(
            200,
            SHELL,
            20,
            "node",
            &[
                "node",
                "/opt/@anthropic-ai/claude-code/cli.js",
                "--from \"/home/me/bin/claude-th.sh\"",
            ],
        ),
    ];
    let found = detect_main_agent(&rows, SHELL, Some("/home/me")).expect("main agent");
    assert_eq!(found.agent, AgentKind::Claude);
    assert_eq!(found.launcher.as_deref(), Some("claude-th"));
    assert_eq!(found.profile_name, "claude-th");
}

#[test]
fn a_quoted_launcher_in_an_ancestor_command_line_names_the_profile() {
    let rows = vec![
        row(SHELL, 1, 10, "bash", &["bash"]),
        row(
            150,
            SHELL,
            15,
            "sh",
            &["sh", "-c \"/home/me/bin/agy-work.sh\" --resume"],
        ),
        row(200, 150, 20, "agy", &["agy"]),
    ];
    let found = detect_main_agent(&rows, SHELL, Some("/home/me")).expect("main agent");
    assert_eq!(found.agent, AgentKind::Agy);
    assert_eq!(found.launcher.as_deref(), Some("agy-work"));
    assert_eq!(launcher_host_pids(&rows, SHELL), vec![150]);
}
