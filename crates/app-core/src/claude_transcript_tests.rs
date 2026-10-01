use super::*;
use serde_json::json;
use std::fs;

const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

fn lines(records: &[Value]) -> String {
    records
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn renders_prompts_replies_and_tool_markers_in_order() {
    let jsonl = lines(&[
        json!({ "type": "user", "timestamp": "2026-09-30T08:15:02.123Z", "message": { "content": "Fix the build" } }),
        json!({ "type": "assistant", "timestamp": "2026-09-30T08:15:05.000Z", "message": { "content": [{ "type": "thinking", "thinking": "secret plan" }] } }),
        json!({ "type": "assistant", "timestamp": "2026-09-30T08:15:05.000Z", "message": { "content": [{ "type": "text", "text": "Running the tests." }] } }),
        json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Bash", "input": { "command": "pnpm test" } }] } }),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "12 passed\n0 failed" }] } }),
        json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "All green." }] } }),
    ]);

    let text = render_transcript(&jsonl, ID);

    assert_eq!(
        text,
        format!(
            "# Claude Code conversation {ID}\n\n\
             ## User — 2026-09-30 08:15:02 UTC\n\nFix the build\n\n\
             ## Claude — 2026-09-30 08:15:05 UTC\n\nRunning the tests.\n\n\
             [tool: Bash] pnpm test\n\n\
             [tool result] 12 passed…\n\n\
             All green.\n"
        )
    );
}

#[test]
fn skips_meta_sidechain_bookkeeping_and_malformed_lines() {
    let jsonl = [
        json!({ "type": "user", "isMeta": true, "message": { "content": "caveat" } }).to_string(),
        json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "sub-agent" }] } }).to_string(),
        json!({ "type": "file-history-snapshot", "snapshot": {} }).to_string(),
        "{ not json".to_string(),
        json!({ "type": "user", "message": { "content": "<local-command-stdout>noise</local-command-stdout>" } }).to_string(),
        json!({ "type": "user", "message": { "content": "Hello" } }).to_string(),
    ]
    .join("\n");

    let text = render_transcript(&jsonl, ID);

    assert!(text.contains("Hello"), "{text}");
    for hidden in ["caveat", "sub-agent", "noise", "not json"] {
        assert!(!text.contains(hidden), "{hidden} leaked into {text}");
    }
}

#[test]
fn reduces_slash_commands_and_marks_errors_and_compaction() {
    let jsonl = lines(&[
        json!({ "type": "user", "message": { "content": "<command-message>usage</command-message>\n<command-name>/usage</command-name>\n<command-args></command-args>" } }),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "is_error": true, "content": [{ "type": "text", "text": "boom" }] }] } }),
        json!({ "type": "user", "isCompactSummary": true, "message": { "content": "long summary" } }),
    ]);

    let text = render_transcript(&jsonl, ID);

    assert!(text.contains("## User\n\n/usage\n"), "{text}");
    assert!(text.contains("[tool error] boom"), "{text}");
    assert!(text.contains("[Conversation compacted]"), "{text}");
    assert!(!text.contains("long summary"), "{text}");
}

#[test]
fn caps_long_tool_markers() {
    let long = "x".repeat(500);
    let jsonl = lines(&[
        json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Write", "input": { "file_path": long } }] } }),
    ]);

    let text = render_transcript(&jsonl, ID);

    assert!(
        text.contains(&format!("[tool: Write] {}…", "x".repeat(200))),
        "{text}"
    );
}

#[test]
fn finds_and_exports_the_session_file_in_any_project_directory() {
    let dir = tempfile::tempdir().expect("temp dir");
    let project = dir.path().join("projects").join("D--work-proj");
    fs::create_dir_all(&project).expect("project dir");
    fs::create_dir_all(dir.path().join("projects").join("other")).expect("other dir");
    let record = json!({ "type": "user", "message": { "content": "Saved prompt" } });
    fs::write(project.join(format!("{ID}.jsonl")), record.to_string()).expect("write transcript");

    assert_eq!(
        find_transcript(dir.path(), ID),
        Some(project.join(format!("{ID}.jsonl")))
    );
    let text = export_transcript(dir.path(), ID).expect("export");
    assert!(text.contains("Saved prompt"), "{text}");
}

#[test]
fn a_missing_session_file_is_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::create_dir_all(dir.path().join("projects").join("p")).expect("project dir");

    assert_eq!(find_transcript(dir.path(), ID), None);
    let error = export_transcript(dir.path(), ID).expect_err("missing file");
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
}
