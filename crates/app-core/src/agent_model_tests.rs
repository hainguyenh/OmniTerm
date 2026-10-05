use super::*;
use std::fs;
use tempfile::tempdir;

#[test]
fn formats_model_names_consistently() {
    assert_eq!(format_model_name("opus"), "Claude Opus");
    assert_eq!(format_model_name("sonnet"), "Claude Sonnet");
    assert_eq!(format_model_name("haiku"), "Claude Haiku");
    assert_eq!(format_model_name("claude-3-7-sonnet"), "Claude 3 7 Sonnet");
    assert_eq!(format_model_name("gpt-6-astra"), "GPT-6 Astra");
    assert_eq!(format_model_name("gpt-5.1-codex"), "GPT-5.1 Codex");
    assert_eq!(format_model_name("gemini-2.5-flash"), "Gemini 2.5 Flash");
    assert_eq!(format_model_name("Gemini 3.8 Flash"), "Gemini 3.8 Flash");
}

#[test]
fn formats_effort_consistently() {
    assert_eq!(format_effort("high"), "High");
    assert_eq!(format_effort("medium"), "Medium");
    assert_eq!(format_effort("low"), "Low");
    assert_eq!(format_effort("xhigh"), "Extra High");
    assert_eq!(format_effort("extra_high"), "Extra High");
}

#[test]
fn parses_model_and_effort_with_parentheses() {
    let (model, effort) = parse_model_and_effort("Gemini 3.8 Flash (High)");
    assert_eq!(model, "Gemini 3.8 Flash");
    assert_eq!(effort.as_deref(), Some("High"));

    let (model_plain, effort_plain) = parse_model_and_effort("gemini-2.5-pro");
    assert_eq!(model_plain, "Gemini 2.5 Pro");
    assert_eq!(effort_plain, None);
}

#[test]
fn resolves_agy_model_from_antigravity_settings() {
    let dir = tempdir().expect("tempdir");
    let cli_dir = dir.path().join("antigravity-cli");
    fs::create_dir_all(&cli_dir).expect("create_dir");
    fs::write(
        cli_dir.join("settings.json"),
        r#"{"model": "Gemini 3.8 Flash (High)"}"#,
    )
    .expect("write");

    let info = resolve_agent_model("agy", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.model, "Gemini 3.8 Flash");
    assert_eq!(info.effort.as_deref(), Some("High"));
    assert_eq!(info.display, "Gemini 3.8 Flash - High");
}

#[test]
fn resolves_codex_model_from_config_toml() {
    let dir = tempdir().expect("tempdir");
    fs::write(
        dir.path().join("config.toml"),
        "model = \"gpt-6-astra\"\nmodel_reasoning_effort = \"high\"\n",
    )
    .expect("write");

    let info = resolve_agent_model("codex", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.model, "GPT-6 Astra");
    assert_eq!(info.effort.as_deref(), Some("High"));
    assert_eq!(info.display, "GPT-6 Astra - High");
}

#[test]
fn resolves_claude_model_from_settings_json() {
    let dir = tempdir().expect("tempdir");
    fs::write(
        dir.path().join("settings.json"),
        r#"{"model": "opus"}"#,
    )
    .expect("write");

    let info = resolve_agent_model("claude", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.model, "Claude Opus");
    assert_eq!(info.effort, None);
    assert_eq!(info.display, "Claude Opus");
}

#[test]
fn returns_none_for_unknown_agent_or_missing_config() {
    let dir = tempdir().expect("tempdir");
    assert!(resolve_agent_model("unknown", Some(dir.path()), None).is_none());
    assert!(resolve_agent_model("agy", Some(dir.path()), None).is_none());
}
