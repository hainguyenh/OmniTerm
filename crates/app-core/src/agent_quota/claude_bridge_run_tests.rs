use std::cell::RefCell;

use serde_json::json;

use super::*;

const NOW: i64 = 1_790_000_000_000;

fn status_input(five: f64) -> String {
    json!({ "rate_limits": { "five_hour": { "used_percentage": five, "resets_at": 1_790_003_600 } } })
        .to_string()
}

fn no_chain(_: &str, _: &str) -> Option<String> {
    panic!("no earlier status line is installed")
}

fn write_bridge(profile: &Path, bridge: &Value) {
    write_atomic(&bridge_file(profile), &bridge.to_string()).expect("write bridge.json");
}

#[test]
fn reads_the_profile_argument() {
    let args = |list: &[&str]| {
        list.iter()
            .map(|arg| (*arg).to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        profile_arg(&args(&["omniterm", STATUSLINE_FLAG, "--profile", "C:/p"])),
        Some(PathBuf::from("C:/p"))
    );
    assert_eq!(
        profile_arg(&args(&["omniterm", STATUSLINE_FLAG, "--profile"])),
        None
    );
    assert_eq!(
        profile_arg(&args(&["omniterm", "--profile", "--other"])),
        None
    );
    assert_eq!(profile_arg(&args(&["omniterm", "--profile", " "])), None);
}

#[test]
fn stores_the_reading_and_prints_its_own_line_without_an_earlier_status_line() {
    let dir = tempfile::tempdir().expect("temp dir");
    let output = statusline_output(dir.path(), &status_input(42.0), NOW, &no_chain);
    assert_eq!(output, "5h 42%\n");
    let stored = std::fs::read_to_string(usage_file(dir.path())).expect("a stored record");
    assert!(parse_usage_record(&stored, NOW).is_some());
}

#[test]
fn keeps_the_last_record_when_the_input_has_no_rate_limits() {
    let dir = tempfile::tempdir().expect("temp dir");
    statusline_output(dir.path(), &status_input(42.0), NOW, &no_chain);
    // Before the session's first reply, the line shows what the profile reported last.
    let output = statusline_output(dir.path(), "{\"session_id\":\"s\"}", NOW, &no_chain);
    assert_eq!(output, "5h 42%\n");
    let stored = std::fs::read_to_string(usage_file(dir.path())).expect("the earlier record");
    assert!(stored.contains("42"));
}

#[test]
fn waits_for_the_first_reply_without_any_record() {
    let dir = tempfile::tempdir().expect("temp dir");
    let output = statusline_output(dir.path(), "{\"session_id\":\"s\"}", NOW, &no_chain);
    assert_eq!(output, "Claude quota: waiting for the first reply\n");
}

#[test]
fn shows_how_full_the_context_window_is() {
    let dir = tempfile::tempdir().expect("temp dir");
    let input = json!({
        "context_window": { "used_percentage": 18.2 },
        "rate_limits": {
            "five_hour": { "used_percentage": 42.0, "resets_at": 1_790_003_600 },
            "seven_day": { "used_percentage": 13.0, "resets_at": 1_790_400_000 },
        },
    })
    .to_string();
    assert_eq!(
        statusline_output(dir.path(), &input, NOW, &no_chain),
        "ctx 18% · 5h 42% · wk 13%\n"
    );
}

#[test]
fn runs_the_earlier_status_line_with_the_same_input() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_bridge(
        dir.path(),
        &json!({ "previousStatusLine": { "type": "command", "command": " my-line " } }),
    );
    let seen = RefCell::new(None);
    let chain = |command: &str, input: &str| {
        *seen.borrow_mut() = Some((command.to_string(), input.to_string()));
        Some("custom line\n".to_string())
    };
    let input = status_input(10.0);
    assert_eq!(
        statusline_output(dir.path(), &input, NOW, &chain),
        "custom line\n"
    );
    assert_eq!(seen.into_inner(), Some(("my-line".to_string(), input)));
}

#[test]
fn falls_back_to_its_own_line_when_the_earlier_status_line_fails_or_prints_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_bridge(
        dir.path(),
        &json!({ "previousStatusLine": { "command": "broken" } }),
    );
    let input = status_input(7.0);
    assert_eq!(
        statusline_output(dir.path(), &input, NOW, &|_, _| None),
        "5h 7%\n"
    );
    assert_eq!(
        statusline_output(dir.path(), &input, NOW, &|_, _| Some(" \n".into())),
        "5h 7%\n"
    );
}

fn guard_profile(five: f64, settings: Option<Value>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    statusline_output(dir.path(), &status_input(five), NOW, &no_chain);
    let app = dir.path().join("app-settings.json");
    if let Some(settings) = settings {
        std::fs::write(&app, settings.to_string()).expect("write app settings");
    }
    write_bridge(dir.path(), &json!({ "appSettings": app.to_string_lossy() }));
    dir
}

fn hook(tool: &str) -> String {
    json!({ "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": {} }).to_string()
}

#[test]
fn denies_a_sub_agent_at_the_limit_for_both_tool_names() {
    let dir = guard_profile(93.0, None);
    for tool in SUB_AGENT_TOOLS {
        let reason = guard_reason(dir.path(), &hook(tool), NOW).expect("denied");
        assert!(reason.contains("93%"), "{reason}");
    }
}

#[test]
fn allows_other_tools_low_usage_and_any_doubt() {
    let dir = guard_profile(93.0, None);
    assert_eq!(guard_reason(dir.path(), &hook("Bash"), NOW), None);
    assert_eq!(guard_reason(dir.path(), "not json", NOW), None);
    // A stale record is no reading.
    assert_eq!(
        guard_reason(dir.path(), &hook("Agent"), NOW + MAX_AGE),
        None
    );
    let low = guard_profile(40.0, None);
    assert_eq!(guard_reason(low.path(), &hook("Agent"), NOW), None);
    let empty = tempfile::tempdir().expect("temp dir");
    assert_eq!(guard_reason(empty.path(), &hook("Agent"), NOW), None);
}

const MAX_AGE: i64 = super::super::claude_bridge::MAX_AGE_MS + 1;

#[test]
fn follows_the_apps_own_limit_and_switches() {
    let raised =
        json!({ "agentQuota": { "agents": { "claude": { "limits": { "session": 95 } } } } });
    assert_eq!(
        guard_reason(
            guard_profile(93.0, Some(raised)).path(),
            &hook("Agent"),
            NOW
        ),
        None
    );
    let off = json!({ "agentQuota": { "agents": { "claude": { "suspendAtLimit": false } } } });
    assert_eq!(
        guard_reason(guard_profile(99.0, Some(off)).path(), &hook("Agent"), NOW),
        None
    );
}

#[test]
fn denies_with_the_documented_pre_tool_use_json() {
    let output: Value = serde_json::from_str(&deny_output("why")).expect("JSON");
    assert_eq!(
        output,
        json!({ "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "why",
        } })
    );
}

#[test]
fn writes_atomically_into_a_new_folder_and_replaces_the_old_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("a").join("b.json");
    write_atomic(&file, "1").expect("first write");
    write_atomic(&file, "2").expect("second write");
    assert_eq!(std::fs::read_to_string(&file).expect("read"), "2");
    let names: Vec<_> = std::fs::read_dir(file.parent().expect("parent"))
        .expect("list")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    assert_eq!(names, ["b.json"], "no temp file is left behind");
}

#[test]
fn runs_a_real_chained_command_and_drops_a_failing_one() {
    let input = status_input(1.0);
    let echoed = if cfg!(windows) {
        "echo chained"
    } else {
        "cat >/dev/null; echo chained"
    };
    assert_eq!(
        run_chain(echoed, &input).map(|out| out.trim().to_string()),
        Some("chained".into())
    );
    assert_eq!(run_chain("exit 3", &input), None);
}
