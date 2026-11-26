use super::*;

const HOME: &str = "C:\\Users\\me";

fn row(pid: u32, parent: u32, image: &str, cmd: &[&str], config: Option<&str>) -> ProcRow {
    ProcRow {
        pid,
        parent,
        start_time: u64::from(pid),
        image: image.to_string(),
        cmd: cmd.iter().map(|arg| arg.to_string()).collect(),
        env: config
            .map(|dir| vec![("CLAUDE_CONFIG_DIR".to_string(), dir.to_string())])
            .unwrap_or_default(),
    }
}

fn census(rows: &[ProcRow], unreadable: &[u32]) -> Vec<ProfileCensus> {
    claude_census(rows, &unreadable.iter().copied().collect(), Some(HOME))
}

/// The default profile as `profile_dir` spells it on this platform.
fn default_dir() -> String {
    profile_dir(
        AgentKind::Claude,
        &row(0, 0, "claude.exe", &[], None),
        Some(HOME),
    )
    .expect("a default profile")
}

fn sessions_of(found: &[ProfileCensus], dir: Option<&str>) -> (usize, usize) {
    found
        .iter()
        .find(|profile| profile.profile_dir.as_deref() == dir)
        .map(|profile| (profile.sessions, profile.headless))
        .unwrap_or_default()
}

#[test]
fn counts_the_sessions_of_each_profile_across_the_machine() {
    let work = "C:\\Users\\me\\.claude-work";
    let rows = [
        // An OmniTerm pane, VS Code's terminal and a second pane, all on the work profile; the
        // work profile is spelt with forward slashes once.
        row(10, 1, "pwsh.exe", &[], None),
        row(11, 10, "claude.exe", &["claude"], Some(work)),
        row(20, 1, "Code.exe", &[], None),
        row(
            21,
            20,
            "claude.exe",
            &["claude"],
            Some("c:/users/me/.claude-work/"),
        ),
        row(31, 1, "claude.exe", &["claude", "--resume"], Some(work)),
        // The default profile, run through node, with a sub-agent under it.
        row(
            40,
            1,
            "node.exe",
            &[
                "node",
                "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
            ],
            None,
        ),
        row(41, 40, "claude.exe", &["claude", "-p", "sub task"], None),
        // Not Claude.
        row(50, 1, "node.exe", &["node", "build.js"], None),
    ];
    let found = census(&rows, &[]);
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(sessions_of(&found, Some(work)), (3, 0));
    assert_eq!(
        sessions_of(&found, Some(default_dir().as_str())),
        (1, 0),
        "the sub-agent belongs to its session"
    );
}

#[test]
fn counts_headless_runs_and_leaves_usage_reads_out() {
    let rows = [
        row(
            11,
            1,
            "claude.exe",
            &["claude", "-p", "fix the build"],
            None,
        ),
        row(12, 1, "claude.exe", &["claude", "--print", "review"], None),
        row(
            13,
            1,
            "claude.exe",
            &["claude", "-p", "/usage", "--no-session-persistence"],
            None,
        ),
        row(14, 1, "claude.exe", &["claude"], None),
    ];
    let found = census(&rows, &[]);
    assert_eq!(sessions_of(&found, Some(default_dir().as_str())), (3, 2));
}

#[test]
fn never_guesses_the_profile_of_a_process_it_could_not_read() {
    let rows = [
        row(11, 1, "claude.exe", &["claude"], None),
        row(12, 1, "claude.exe", &["claude"], None),
    ];
    let found = census(&rows, &[12]);
    assert_eq!(sessions_of(&found, Some(default_dir().as_str())), (1, 0));
    assert_eq!(sessions_of(&found, None), (1, 0));
}

#[test]
fn survives_a_parent_cycle() {
    let rows = [
        row(11, 12, "claude.exe", &["claude"], None),
        row(12, 11, "pwsh.exe", &[], None),
    ];
    assert_eq!(claude_mains(&rows), vec![0]);
}
