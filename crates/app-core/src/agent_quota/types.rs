//! Wire types of the agent quota commands. Field names follow the renderer's TypeScript types in
//! `ui/features/agent-quota/usage/types.ts`.

use std::path::PathBuf;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Agy,
}

impl AgentKind {
    pub const ALL: [AgentKind; 3] = [AgentKind::Claude, AgentKind::Codex, AgentKind::Agy];

    pub fn as_str(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::Agy => "agy",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|agent| agent.as_str() == value)
    }

    /// The variable that points the agent at a profile directory.
    pub(crate) fn profile_variable(self) -> &'static str {
        match self {
            AgentKind::Claude => "CLAUDE_CONFIG_DIR",
            AgentKind::Codex => "CODEX_HOME",
            AgentKind::Agy => "AGY_HOME",
        }
    }

    /// The default profile directory, relative to the home directory.
    pub(crate) fn default_dir(self) -> &'static str {
        match self {
            AgentKind::Claude => ".claude",
            AgentKind::Codex => ".codex",
            AgentKind::Agy => ".gemini",
        }
    }
}

/// A quota window. `Session` is the rolling ~5-hour window every provider has.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowKind {
    Session,
    Weekly,
    Monthly,
}

impl WindowKind {
    pub(crate) const ORDER: [WindowKind; 3] =
        [WindowKind::Session, WindowKind::Weekly, WindowKind::Monthly];
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownEntry {
    pub label: String,
    pub used_pct: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub kind: WindowKind,
    /// 0–100. Providers that report "remaining" are converted before this point.
    pub used_pct: f64,
    /// Epoch milliseconds, when the provider says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
    /// Provider wording, e.g. "Current week (all models)".
    pub label: String,
    /// Per-model readings behind a split window; the window itself carries the highest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breakdown: Option<Vec<BreakdownEntry>>,
}

/// Where a reading came from. Neither source uses a token or the network.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QuotaSource {
    Cli,
    Rollout,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaError {
    ParseFailed,
    Timeout,
    NotSignedIn,
    Unsupported,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct QuotaCredits {
    pub balance: Option<f64>,
    pub unlimited: bool,
}

/// One reading of a profile's quota. A snapshot with `error` carries no windows the guard may act
/// on: stale or unparsed data must never suspend an agent.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub windows: Vec<QuotaWindow>,
    pub fetched_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<QuotaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits: Option<QuotaCredits>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<QuotaError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl QuotaSnapshot {
    pub(crate) fn failure(fetched_at: i64, error: QuotaError, message: impl Into<String>) -> Self {
        Self {
            windows: Vec::new(),
            fetched_at,
            source: None,
            credits: None,
            error: Some(error),
            message: Some(message.into()),
        }
    }

    pub(crate) fn reading(fetched_at: i64, source: QuotaSource, windows: Vec<QuotaWindow>) -> Self {
        Self {
            windows,
            fetched_at,
            source: Some(source),
            credits: None,
            error: None,
            message: None,
        }
    }
}

/// Which Antigravity model pool a profile draws from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelFamily {
    Gemini,
    Claude,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchUsageRequest {
    pub agent: AgentKind,
    pub profile_dir: Option<PathBuf>,
    /// Name of the profile launcher the user ran (e.g. `claude-th`), resolved by name only.
    pub launcher: Option<String>,
    /// `None` is "auto": the provider detects the active family itself.
    pub model_family: Option<ModelFamily>,
    /// Whether the request said `auto` explicitly; part of the in-flight key, as before.
    pub model_family_auto: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WakeRequest {
    pub agent: AgentKind,
    pub profile_dir: Option<PathBuf>,
    pub launcher: Option<String>,
    pub prompt: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WakeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl WakeResult {
    pub(crate) fn failed(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: Some(message.into()),
        }
    }
}

/// A profile the user can start, found by `list_profiles` (default dir, profile dir or launcher).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProfile {
    pub agent: AgentKind,
    /// `claude` for the default profile, else the launcher or profile name.
    pub profile_name: String,
    /// The profile's directory; null for a launcher, which sets its own.
    pub profile_dir: Option<PathBuf>,
    pub launcher: Option<String>,
}
