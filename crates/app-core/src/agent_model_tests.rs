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
    fs::write(dir.path().join("settings.json"), r#"{"model": "opus"}"#).expect("write");

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

#[test]
fn formats_unknown_and_blank_effort_levels() {
    assert_eq!(format_effort("  max  "), "Max");
    assert_eq!(format_effort("   "), "");
}

#[test]
fn formats_model_names_with_empty_segments_and_date_suffixes() {
    assert_eq!(format_model_name("gemini--pro"), "Gemini  Pro");
    assert_eq!(format_model_name("claude--opus"), "Claude  Opus");
    assert_eq!(format_model_name("claude-opus-4-20250514"), "Claude Opus 4");
    assert_eq!(format_model_name("  custom-model  "), "custom-model");
}

#[test]
fn unclosed_parenthesis_is_part_of_the_model_name() {
    let (model, effort) = parse_model_and_effort("opus (high");
    assert_eq!(model, "opus (high");
    assert_eq!(effort, None);
}

#[test]
fn empty_effort_is_kept_but_not_displayed() {
    let info = build_info("Claude Opus".to_string(), Some(String::new()));
    assert_eq!(info.effort.as_deref(), Some(""));
    assert_eq!(info.display, "Claude Opus");
}

#[test]
fn extracts_quoted_toml_values_only_for_the_exact_key() {
    assert_eq!(
        extract_toml_value("model = \"gpt-5\"", "model"),
        Some("gpt-5")
    );
    assert_eq!(extract_toml_value("  model='o3'  ", "model"), Some("o3"));
    assert_eq!(extract_toml_value("model = gpt-5", "model"), None);
    assert_eq!(
        extract_toml_value("model_reasoning_effort = \"low\"", "model"),
        None
    );
    assert_eq!(extract_toml_value("approval = \"never\"", "model"), None);
}

#[test]
fn agy_falls_back_to_profile_settings_when_cli_settings_are_unusable() {
    let dir = tempdir().expect("tempdir");
    let cli_dir = dir.path().join("antigravity-cli");
    fs::create_dir_all(&cli_dir).expect("create_dir");
    fs::write(cli_dir.join("settings.json"), "not json").expect("write cli settings");
    fs::write(
        dir.path().join("settings.json"),
        r#"{"theme": "dark", "model": "gemini-3-pro (low)"}"#,
    )
    .expect("write settings");

    let info = resolve_agent_model("Gemini", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.model, "Gemini 3 Pro");
    assert_eq!(info.display, "Gemini 3 Pro - Low");
}

#[test]
fn agy_settings_without_a_model_resolve_to_none() {
    let dir = tempdir().expect("tempdir");
    fs::write(dir.path().join("settings.json"), r#"{"theme": "dark"}"#).expect("write");
    assert!(resolve_agent_model("agy", Some(dir.path()), None).is_none());
}

#[test]
fn codex_defaults_the_model_and_hides_an_empty_effort() {
    let dir = tempdir().expect("tempdir");
    fs::write(
        dir.path().join("config.toml"),
        "[profile]\nmodel_reasoning_effort = ''\napproval = \"never\"\n",
    )
    .expect("write");

    let info = resolve_agent_model(" CODEX ", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.model, "Codex");
    assert_eq!(info.effort.as_deref(), Some(""));
    assert_eq!(info.display, "Codex");
}

#[test]
fn codex_without_a_config_file_resolves_to_none() {
    let dir = tempdir().expect("tempdir");
    assert!(resolve_agent_model("codex", Some(dir.path()), None).is_none());
}

#[test]
fn claude_falls_back_to_dot_claude_json_and_none_without_a_model() {
    let dir = tempdir().expect("tempdir");
    fs::write(dir.path().join("settings.json"), "{broken").expect("write settings");
    fs::write(
        dir.path().join(".claude.json"),
        r#"{"model": "sonnet (high)"}"#,
    )
    .expect("write claude json");
    let info = resolve_agent_model("claude", Some(dir.path()), None).expect("resolve");
    assert_eq!(info.display, "Claude Sonnet - High");

    let empty = tempdir().expect("tempdir");
    fs::write(empty.path().join("settings.json"), r#"{"model": 4}"#).expect("write");
    assert!(resolve_agent_model("claude", Some(empty.path()), None).is_none());
}

#[test]
fn unknown_agent_without_a_profile_dir_resolves_to_none() {
    assert!(resolve_agent_model("copilot", None, None).is_none());
}
