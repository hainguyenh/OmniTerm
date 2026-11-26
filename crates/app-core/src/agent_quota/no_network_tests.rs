//! Agent Quota must never touch a credential or the network: its only inputs are the agents' own
//! CLIs (or the user's profile launchers), Codex's rollout logs and Claude Code's cached reading.
//! This fails the build if a token file, an HTTP client or a request sneaks back in.

use std::fs;
use std::path::Path;

const FORBIDDEN: &[&str] = &[
    "credentials.json",
    "auth.json",
    "http://",
    "https://",
    "reqwest",
    "ureq",
    "hyper",
    "tcpstream",
    "udpsocket",
    "api.anthropic.com",
    "chatgpt.com",
];

#[test]
fn reads_no_credential_and_makes_no_network_request() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("agent_quota");
    let mut checked = 0;
    for entry in fs::read_dir(&dir).expect("list the agent_quota sources") {
        let path = entry.expect("a directory entry").path();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned();
        if !name.ends_with(".rs") || name.ends_with("_tests.rs") || name == "fake_deps.rs" {
            continue;
        }
        let text = fs::read_to_string(&path)
            .expect("read a source file")
            .to_ascii_lowercase();
        for needle in FORBIDDEN {
            assert!(!text.contains(needle), "{name} mentions {needle}");
        }
        checked += 1;
    }
    assert!(checked > 10, "only {checked} sources were checked");
}
