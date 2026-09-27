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

fn with_env(mut row: ProcRow, key: &str, value: &str) -> ProcRow {
    row.env.push((key.to_string(), value.to_string()));
    row
}

const SHELL: u32 = 100;

fn shell() -> ProcRow {
    row(SHELL, 1, 10, "pwsh.exe", &["pwsh"])
}

#[test]
fn classifies_native_and_packaged_agents() {
    let claude_node = row(
        2,
        0,
        0,
        "node.exe",
        &[
            "node",
            "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
        ],
    );
    let codex_node = row(
        4,
        0,
        0,
        "node",
        &["node", "/usr/lib/node_modules/@openai/codex/bin/codex.js"],
    );
    assert_eq!(
        classify(&row(1, 0, 0, "claude.exe", &[])),
        Some(AgentKind::Claude)
    );
    assert_eq!(classify(&claude_node), Some(AgentKind::Claude));
    assert_eq!(
        classify(&row(3, 0, 0, "codex-x86_64-pc-windows-msvc.exe", &[])),
        Some(AgentKind::Codex)
    );
    assert_eq!(classify(&codex_node), Some(AgentKind::Codex));
}

#[test]
fn scripts_shells_tools_and_other_agents_are_not_monitored() {
    for image in [
        "node.exe",
        "python.exe",
        "pwsh.exe",
        "cmd.exe",
        "cargo.exe",
        "agy.exe",
        "language_server_windows_x64.exe",
    ] {
        assert_eq!(
            classify(&row(1, 0, 0, image, &["x", "build.js"])),
            None,
            "{image}"
        );
    }
    let mcp = row(
        1,
        0,
        0,
        "node.exe",
        &["node", "@modelcontextprotocol/server-filesystem"],
    );
    assert_eq!(classify(&mcp), None);
}

#[test]
fn a_launcher_names_the_profile_without_reading_any_environment() {
    let rows = vec![
        shell(),
        row(
            101,
            SHELL,
            20,
            "cmd.exe",
            &[
                "C:\\WINDOWS\\system32\\cmd.exe",
                "/d",
                "/c",
                "\"C:\\Users\\me\\.local\\bin\\claude-th.cmd\"",
            ],
        ),
        row(102, 101, 21, "claude.exe", &["claude"]),
        row(103, 102, 30, "claude.exe", &["claude", "-p", "sub task"]),
        row(104, 102, 31, "node.exe", &["node", "scripts/test.mjs"]),
    ];
    let found = detect_main_agent(&rows, SHELL, Some("C:\\Users\\me")).expect("an agent");
    assert_eq!(found.agent, AgentKind::Claude);
    assert_eq!((found.pid, found.start_time), (102, 21));
    assert_eq!(found.launcher.as_deref(), Some("claude-th"));
    assert_eq!(found.profile_name, "claude-th");
    assert_eq!(found.sub_agent_count, 1);
    assert_eq!(needs_profile_env(&rows, SHELL), None);
}

#[test]
fn without_a_launcher_only_the_main_agent_needs_its_environment() {
    let rows = vec![
        shell(),
        with_env(
            row(101, SHELL, 20, "claude.exe", &["claude"]),
            "CLAUDE_CONFIG_DIR",
            "C:\\Users\\me\\claude-profiles\\claude-work",
        ),
    ];
    assert_eq!(needs_profile_env(&rows, SHELL), Some(101));
    let found = detect_main_agent(&rows, SHELL, Some("C:\\Users\\me")).expect("an agent");
    assert_eq!(found.launcher, None);
    assert_eq!(
        found.profile_dir.as_deref(),
        Some("C:\\Users\\me\\claude-profiles\\claude-work")
    );
    assert_eq!(found.profile_name, "claude-work");
    assert_eq!(needs_profile_env(&[shell()], SHELL), None);
}

#[test]
fn memory_is_read_only_where_it_decides_something() {
    let rows = vec![
        shell(),
        row(101, SHELL, 20, "cmd.exe", &[]),
        row(102, 101, 21, "claude.exe", &[]),
        row(103, 102, 22, "node.exe", &[]),
        row(104, SHELL, 23, "git.exe", &[]),
        row(105, 104, 24, "cmd.exe", &[]),
    ];
    assert_eq!(script_host_pids(&rows), vec![103]);
    // Only the cmd.exe between the shell and the agent — not an unrelated one elsewhere.
    assert_eq!(launcher_host_pids(&rows, SHELL), vec![101]);
    assert!(launcher_host_pids(&[shell()], SHELL).is_empty());
    let looped = vec![
        row(10, 11, 0, "cmd.exe", &[]),
        row(11, 10, 0, "cmd.exe", &[]),
        row(12, 10, 1, "claude.exe", &[]),
    ];
    assert_eq!(launcher_host_pids(&looped, 99), Vec::<u32>::new());
    let orphan = vec![shell(), row(102, SHELL, 21, "claude.exe", &[])];
    assert!(launcher_host_pids(&orphan, SHELL).is_empty());
}

#[test]
fn launcher_names_are_strict() {
    assert_eq!(
        launcher_name("C:\\bin\\Claude-TH.CMD", AgentKind::Claude).as_deref(),
        Some("claude-th")
    );
    assert_eq!(
        launcher_name("'/x/codex-alt.bat'", AgentKind::Codex).as_deref(),
        Some("codex-alt")
    );
    for token in [
        "claude.cmd",
        "claude-.cmd",
        "claude-th.exe",
        "claude-t h.cmd",
        "claude-a&b.cmd",
        "codex-x.cmd",
        "notclaude-x.cmd",
    ] {
        assert_eq!(launcher_name(token, AgentKind::Claude), None, "{token}");
    }
    let long = format!("claude-{}.cmd", "a".repeat(41));
    assert_eq!(launcher_name(&long, AgentKind::Claude), None);
}

#[test]
fn falls_back_to_the_default_profile_directory() {
    let rows = vec![shell(), row(101, SHELL, 20, "codex.exe", &["codex"])];
    let found = detect_main_agent(&rows, SHELL, Some("/home/me")).expect("an agent");
    assert_eq!(found.agent, AgentKind::Codex);
    let dir = found.profile_dir.expect("default dir");
    assert!(dir.ends_with(".codex"), "{dir}");
    assert_eq!(found.profile_name, "codex");
    assert_eq!(profile_dir(AgentKind::Claude, &rows[1], None), None);
    assert_eq!(profile_name(AgentKind::Claude, None), "claude");
    assert_eq!(
        profile_name(AgentKind::Claude, Some("C:\\Users\\me\\.claude\\")),
        "claude"
    );
    assert_eq!(profile_name(AgentKind::Codex, Some("")), "codex");
}

#[test]
fn blank_profile_variables_are_ignored() {
    let agent = with_env(row(1, 0, 0, "claude.exe", &[]), "claude_config_dir", "  ");
    assert_eq!(
        profile_dir(AgentKind::Claude, &agent, Some("/h")),
        Some(
            PathBuf::from("/h")
                .join(".claude")
                .to_string_lossy()
                .into_owned()
        )
    );
}

#[test]
fn no_agent_means_no_detection() {
    let rows = vec![
        shell(),
        row(101, SHELL, 20, "node.exe", &["node", "server.js"]),
    ];
    assert_eq!(detect_main_agent(&rows, SHELL, None), None);
    let rows = vec![shell(), row(200, 1, 20, "claude.exe", &[])];
    assert_eq!(detect_main_agent(&rows, SHELL, None), None);
}

#[test]
fn the_oldest_top_level_agent_wins() {
    let rows = vec![
        shell(),
        row(102, SHELL, 40, "codex.exe", &[]),
        row(101, SHELL, 30, "claude.exe", &[]),
    ];
    let found = detect_main_agent(&rows, SHELL, None).expect("an agent");
    assert_eq!(found.pid, 101);
}

#[test]
fn suspend_targets_freeze_sub_agents_but_not_scripts() {
    let rows = vec![
        shell(),
        row(101, SHELL, 20, "claude.exe", &[]),
        row(102, 101, 21, "node.exe", &["node", "vitest"]),
        row(103, 102, 22, "codex.exe", &[]),
        row(104, 101, 23, "python.exe", &["python", "script.py"]),
        row(105, 101, 24, "claude.exe", &["claude", "-p", "sub"]),
    ];
    let targets = suspend_targets(&rows, 101, 20);
    let pids: Vec<u32> = targets.iter().map(|t| t.pid).collect();
    assert_eq!(pids, vec![101, 105, 103]);
    assert!(targets.iter().all(|t| t.threads.is_empty()));
    assert!(
        suspend_targets(&rows, 101, 999).is_empty(),
        "a recycled pid is refused"
    );
}

#[test]
fn cycles_in_the_parent_map_terminate() {
    let rows = vec![
        row(1, 2, 0, "claude.exe", &[]),
        row(2, 1, 0, "node.exe", &["node", "@openai/codex"]),
        row(3, 3, 0, "codex.exe", &[]),
    ];
    assert_eq!(suspend_targets(&rows, 1, 0).len(), 2);
    assert!(detect_main_agent(&rows, 1, None).is_some());
    // A launcher search through a cyclic ancestry stops instead of spinning.
    let looped = vec![
        row(10, 11, 0, "cmd.exe", &["cmd"]),
        row(11, 10, 0, "cmd.exe", &["cmd"]),
        row(12, 10, 1, "claude.exe", &[]),
    ];
    assert_eq!(
        detect_main_agent(&looped, 11, None).and_then(|found| found.launcher),
        None
    );
}

#[test]
fn detected_agents_serialize_in_camel_case() {
    let rows = vec![shell(), row(101, SHELL, 20, "claude.exe", &[])];
    let found = detect_main_agent(&rows, SHELL, Some("/h")).expect("an agent");
    let json = serde_json::to_value(&found).expect("serialize");
    assert_eq!(json["agent"], "claude");
    assert_eq!(json["startTime"], 20);
    assert_eq!(json["profileName"], "claude");
    assert_eq!(json["launcher"], serde_json::Value::Null);
    assert_eq!(json["subAgentCount"], 0);
}
