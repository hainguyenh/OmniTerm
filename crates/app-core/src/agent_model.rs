//! Resolution and formatting of AI agent model and reasoning effort.
//!
//! Inspects an agent's configuration (settings.json, config.toml) to determine
//! the active model name and reasoning effort level, formatted for UI display
//! (e.g., `<Model Name - effort>`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "agent_model_tests.rs"]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelInfo {
    pub model: String,
    pub effort: Option<String>,
    pub display: String,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn format_effort(effort: &str) -> String {
    let lower = effort.trim().to_ascii_lowercase();
    match lower.as_str() {
        "high" => "High".to_string(),
        "medium" => "Medium".to_string(),
        "low" => "Low".to_string(),
        "xhigh" | "extra-high" | "extra_high" => "Extra High".to_string(),
        _ => {
            let mut chars = effort.trim().chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }
    }
}

pub fn format_model_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("gpt-") {
        let capitalized = rest
            .split(['-', '_'])
            .map(|part| {
                if part.eq_ignore_ascii_case("codex") {
                    "Codex".to_string()
                } else if part.chars().all(|c| c.is_ascii_digit() || c == '.') {
                    part.to_string()
                } else {
                    let mut c = part.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    }
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("GPT-{capitalized}")
    } else if let Some(rest) = trimmed.strip_prefix("gemini-") {
        let parts = rest
            .split(['-', '_'])
            .map(|part| {
                let mut c = part.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("Gemini {parts}")
    } else if trimmed.eq_ignore_ascii_case("opus") {
        "Claude Opus".to_string()
    } else if trimmed.eq_ignore_ascii_case("sonnet") {
        "Claude Sonnet".to_string()
    } else if trimmed.eq_ignore_ascii_case("haiku") {
        "Claude Haiku".to_string()
    } else if let Some(rest) = trimmed.strip_prefix("claude-") {
        let parts = rest
            .split(['-', '_'])
            .filter(|p| !p.chars().all(|c| c.is_ascii_digit()) || p.len() <= 3)
            .map(|part| {
                let mut c = part.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("Claude {parts}")
    } else {
        trimmed.to_string()
    }
}

fn build_info(model: String, effort: Option<String>) -> AgentModelInfo {
    let display = match &effort {
        Some(e) if !e.is_empty() => format!("{model} - {e}"),
        _ => model.clone(),
    };
    AgentModelInfo {
        model,
        effort,
        display,
    }
}

fn parse_model_and_effort(raw: &str) -> (String, Option<String>) {
    let trimmed = raw.trim();
    if let Some(open_idx) = trimmed.find('(') {
        if let Some(close_idx) = trimmed[open_idx..].find(')') {
            let model_part = trimmed[..open_idx].trim();
            let effort_part = &trimmed[open_idx + 1..open_idx + close_idx];
            return (
                format_model_name(model_part),
                Some(format_effort(effort_part)),
            );
        }
    }
    (format_model_name(trimmed), None)
}

fn resolve_agy_model(profile_dir: &Path) -> Option<AgentModelInfo> {
    let candidates = [
        profile_dir.join("antigravity-cli").join("settings.json"),
        profile_dir.join("settings.json"),
    ];

    for path in &candidates {
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if let Some(model_str) = val.get("model").and_then(Value::as_str) {
                    let (model, effort) = parse_model_and_effort(model_str);
                    return Some(build_info(model, effort));
                }
            }
        }
    }
    None
}

fn extract_toml_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let trimmed = line.trim();
    if !trimmed.starts_with(key) {
        return None;
    }
    let rest = trimmed[key.len()..].trim_start();
    if !rest.starts_with('=') {
        return None;
    }
    let value_part = rest[1..].trim();
    value_part
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| {
            value_part
                .strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
        })
}

fn resolve_codex_model(profile_dir: &Path) -> Option<AgentModelInfo> {
    let config_path = profile_dir.join("config.toml");
    let text = fs::read_to_string(config_path).ok()?;

    let mut raw_model = None;
    let mut raw_effort = None;

    for line in text.lines() {
        if let Some(m) = extract_toml_value(line, "model") {
            raw_model = Some(m);
        } else if let Some(e) = extract_toml_value(line, "model_reasoning_effort") {
            raw_effort = Some(e);
        }
    }

    let model = format_model_name(raw_model.unwrap_or("Codex"));
    let effort = raw_effort.map(format_effort);
    Some(build_info(model, effort))
}

fn resolve_claude_model(profile_dir: &Path) -> Option<AgentModelInfo> {
    let candidates = [
        profile_dir.join("settings.json"),
        profile_dir.join(".claude.json"),
    ];

    for path in &candidates {
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if let Some(model_str) = val.get("model").and_then(Value::as_str) {
                    let (model, effort) = parse_model_and_effort(model_str);
                    return Some(build_info(model, effort));
                }
            }
        }
    }
    None
}

/// Resolve the model information (name, effort, display) for an AI agent.
pub fn resolve_agent_model(
    agent: &str,
    profile_dir: Option<&Path>,
    _cwd: Option<&Path>,
) -> Option<AgentModelInfo> {
    let lower_agent = agent.trim().to_ascii_lowercase();
    let home = home_dir();

    let resolved_dir = profile_dir.map(PathBuf::from).or_else(|| {
        let home = home.as_ref()?;
        match lower_agent.as_str() {
            "agy" | "gemini" => Some(home.join(".gemini")),
            "codex" => Some(home.join(".codex")),
            "claude" => Some(home.join(".claude")),
            _ => None,
        }
    })?;

    match lower_agent.as_str() {
        "agy" | "gemini" => resolve_agy_model(&resolved_dir),
        "codex" => resolve_codex_model(&resolved_dir),
        "claude" => resolve_claude_model(&resolved_dir),
        _ => None,
    }
}
