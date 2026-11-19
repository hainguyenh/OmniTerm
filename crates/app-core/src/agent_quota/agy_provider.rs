//! Antigravity CLI (agy) usage from its `/usage` command: `agy -p /usage`, non-interactive. The
//! command needs well over 30 seconds at times (upstream quota fetch latency), hence the timeout.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::agy_bridge::{agy_home, agy_usage_file, parse_agy_record};
use super::agy_usage::{is_agy_model_match, parse_agy_usage};
use super::claude_provider::redact_sample;
use super::deps::{CliOptions, ProviderDeps};
use super::launcher::agent_command;
use super::types::{AgentKind, ModelFamily, QuotaError, QuotaSnapshot, QuotaSource};

const USAGE_TIMEOUT: Duration = Duration::from_secs(45);
/// The status line record is a few hundred bytes; anything past this is not one.
const BRIDGE_TAIL: u64 = 64 * 1024;

/// The model family the profile's settings select, when they name one.
pub fn detect_agy_active_family(
    profile_dir: Option<&Path>,
    deps: &dyn ProviderDeps,
) -> Option<ModelFamily> {
    let default_dir = deps.home().join(".gemini");
    let base = profile_dir.map_or_else(|| default_dir.clone(), Path::to_path_buf);
    let candidates = [
        base.join("antigravity-cli").join("settings.json"),
        base.join("settings.json"),
        default_dir.join("antigravity-cli").join("settings.json"),
        default_dir.join("settings.json"),
    ];
    candidates.iter().find_map(|file| {
        let text = deps.read_tail(file, 4096)?;
        let doc: Value = serde_json::from_str(&text).ok()?;
        let model = doc.get("model")?.as_str()?;
        [ModelFamily::Gemini, ModelFamily::Claude]
            .into_iter()
            .find(|family| is_agy_model_match(model, *family))
    })
}

/// The status line bridge's last record for the profile, read for the `active` model family.
pub(crate) fn agy_bridge_reading(
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    active: Option<ModelFamily>,
    deps: &dyn ProviderDeps,
) -> Option<QuotaSnapshot> {
    agy_home(profile_dir, launcher, deps.home())
        .and_then(|home| deps.read_tail(&agy_usage_file(&home), BRIDGE_TAIL))
        .and_then(|raw| parse_agy_record(&raw, deps.now(), active))
}

pub fn fetch_agy_usage(
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    family: Option<ModelFamily>,
    deps: &dyn ProviderDeps,
) -> QuotaSnapshot {
    let active = family.or_else(|| detect_agy_active_family(profile_dir, deps));
    // The status line bridge's record, once the profile has one: no CLI run needed.
    if let Some(reading) = agy_bridge_reading(profile_dir, launcher, active, deps) {
        return reading;
    }
    let Some(command) = agent_command(AgentKind::Agy, profile_dir, launcher, deps) else {
        return QuotaSnapshot::failure(
            deps.now(),
            QuotaError::Unsupported,
            "Antigravity CLI not found.",
        );
    };
    let options = CliOptions {
        env: command.env,
        timeout: USAGE_TIMEOUT,
        cwd: Some(deps.tmp().to_path_buf()),
    };
    let args = ["-p".to_string(), "/usage".to_string()];

    let mut last =
        QuotaSnapshot::failure(deps.now(), QuotaError::Failed, "agy -p /usage did not run.");
    for attempt in 0..2 {
        let result = deps.run(&command.exe, &args, &options);
        let now = deps.now();
        if result.timed_out {
            last = QuotaSnapshot::failure(now, QuotaError::Timeout, "agy -p /usage timed out.");
            continue;
        }
        let output = format!("{}\n{}", result.stdout, result.stderr);
        match parse_agy_usage(&output, now, active) {
            Ok(windows) => return QuotaSnapshot::reading(now, QuotaSource::Cli, windows),
            Err(failure) => {
                last = QuotaSnapshot::failure(now, failure.error, failure.message);
                if failure.error == QuotaError::NotSignedIn {
                    return last;
                }
                if attempt == 1 {
                    deps.log(&format!(
                        "[agent-quota] unrecognised agy -p /usage output: {}",
                        redact_sample(&output)
                    ));
                }
            }
        }
    }
    last
}
