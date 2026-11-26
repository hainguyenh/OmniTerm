//! Starting a new session window by sending the agent one tiny prompt.

use std::time::Duration;

use super::deps::{CliOptions, ProviderDeps};
use super::launcher::{agent_command, is_safe_prompt};
use super::types::{AgentKind, WakeRequest, WakeResult};

const WAKE_TIMEOUT: Duration = Duration::from_secs(120);

fn product(agent: AgentKind) -> &'static str {
    match agent {
        AgentKind::Claude => "Claude Code",
        AgentKind::Codex => "Codex",
        AgentKind::Agy => "Antigravity",
    }
}

/// The prompt runs as a separate process in the scratch directory, so it touches no project and
/// works while the terminal's own agent is frozen. It goes through the profile's launcher when the
/// terminal used one (`claude-th -p hi …`). Claude is pinned to Haiku, the cheapest model, with no
/// tools; Codex runs read-only and skips the git check.
pub fn wake_agent(request: &WakeRequest, deps: &dyn ProviderDeps) -> WakeResult {
    if !is_safe_prompt(&request.prompt) {
        return WakeResult::failed(
            "The wake prompt may only contain letters, digits and simple punctuation.",
        );
    }
    let Some(command) = agent_command(
        request.agent,
        request.profile_dir.as_deref(),
        request.launcher.as_deref(),
        deps,
    ) else {
        return WakeResult::failed(format!("{} CLI not found.", product(request.agent)));
    };
    let prompt = request.prompt.clone();
    let args: Vec<String> = match request.agent {
        AgentKind::Claude => vec![
            "--tools".into(),
            String::new(),
            "--no-session-persistence".into(),
            "--disable-slash-commands".into(),
            "--strict-mcp-config".into(),
            "-p".into(),
            prompt,
            "--model".into(),
            "haiku".into(),
        ],
        AgentKind::Agy => vec!["-p".into(), prompt, "--disable-slash-commands".into()],
        AgentKind::Codex => vec![
            "exec".into(),
            "--skip-git-repo-check".into(),
            "--sandbox".into(),
            "read-only".into(),
            prompt,
        ],
    };
    let options = CliOptions {
        env: command.env,
        timeout: WAKE_TIMEOUT,
        cwd: Some(deps.tmp().to_path_buf()),
    };
    let result = deps.run(&command.exe, &args, &options);
    if result.timed_out {
        return WakeResult::failed("The wake prompt timed out.");
    }
    if result.code != Some(0) {
        let detail: String = result
            .stderr
            .trim()
            .lines()
            .last()
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect();
        if detail.is_empty() {
            let code = result
                .code
                .map_or_else(|| "null".to_string(), |code| code.to_string());
            return WakeResult::failed(format!("The agent exited with code {code}."));
        }
        return WakeResult::failed(detail);
    }
    WakeResult {
        ok: true,
        message: None,
    }
}
