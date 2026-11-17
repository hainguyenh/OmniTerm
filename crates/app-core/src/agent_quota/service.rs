//! The agent quota service behind the desktop commands: request validation at the IPC boundary
//! and one probe per profile at a time.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};

use serde_json::Value;

use super::agy_provider::fetch_agy_usage;
use super::claude_provider::fetch_claude_usage;
use super::codex_rollout::fetch_codex_usage;
use super::deps::{Platform, ProviderDeps};
use super::launcher::is_launcher_name;
use super::profiles::list_profiles;
use super::types::{
    AgentKind, DiscoveredProfile, FetchUsageRequest, ModelFamily, QuotaError, QuotaSnapshot,
    WakeRequest, WakeResult,
};
use super::wake::wake_agent;

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value
        .as_object()
        .and_then(|record| record.get(key))
        .filter(|value| !value.is_null())
}

fn agent(value: &Value) -> Result<AgentKind, String> {
    field(value, "agent")
        .and_then(Value::as_str)
        .and_then(AgentKind::parse)
        .ok_or_else(|| "Unknown agent".to_string())
}

fn optional_dir(value: &Value) -> Result<Option<PathBuf>, String> {
    match field(value, "profileDir") {
        None => Ok(None),
        Some(Value::String(dir)) if dir.is_empty() => Ok(None),
        Some(Value::String(dir)) if dir.chars().count() <= 1024 && !dir.contains('\0') => {
            Ok(Some(PathBuf::from(dir)))
        }
        Some(_) => Err("Invalid profile directory".to_string()),
    }
}

/// A launcher is only ever a bare, validated name; it is resolved here, never run as a path.
fn optional_launcher(value: &Value, agent: AgentKind) -> Result<Option<String>, String> {
    match field(value, "launcher") {
        None => Ok(None),
        Some(Value::String(name)) if name.is_empty() => Ok(None),
        Some(Value::String(name)) if is_launcher_name(name, agent) => Ok(Some(name.clone())),
        Some(_) => Err("Invalid profile launcher".to_string()),
    }
}

/// Validate a renderer request; everything crossing the IPC boundary is untrusted.
pub fn parse_fetch_request(value: &Value) -> Result<FetchUsageRequest, String> {
    let agent = agent(value)?;
    let family = field(value, "modelFamily").and_then(Value::as_str);
    Ok(FetchUsageRequest {
        agent,
        profile_dir: optional_dir(value)?,
        launcher: optional_launcher(value, agent)?,
        model_family: match family {
            Some("gemini") => Some(ModelFamily::Gemini),
            Some("claude") => Some(ModelFamily::Claude),
            _ => None,
        },
        model_family_auto: family == Some("auto"),
    })
}

pub fn parse_wake_request(value: &Value) -> Result<WakeRequest, String> {
    let agent = agent(value)?;
    let Some(Value::String(prompt)) = field(value, "prompt") else {
        return Err("Missing wake prompt".to_string());
    };
    Ok(WakeRequest {
        agent,
        profile_dir: optional_dir(value)?,
        launcher: optional_launcher(value, agent)?,
        prompt: prompt.clone(),
    })
}

fn profile_key(
    agent: AgentKind,
    launcher: Option<&str>,
    family: &str,
    dir: Option<&Path>,
) -> String {
    let dir = dir
        .map(|dir| dir.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    format!(
        "{}:{}:{family}:{dir}",
        agent.as_str(),
        launcher.unwrap_or_default()
    )
}

struct Slot<T> {
    value: Mutex<Option<T>>,
    ready: Condvar,
}

/// Concurrent calls with the same key share the first caller's answer.
struct InFlight<T> {
    slots: Mutex<HashMap<String, Arc<Slot<T>>>>,
}

impl<T: Clone> InFlight<T> {
    fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
        }
    }

    fn run(&self, key: String, work: impl FnOnce() -> T, crashed: impl FnOnce(String) -> T) -> T {
        let (slot, leader) = {
            let mut slots = self.slots.lock().unwrap_or_else(PoisonError::into_inner);
            match slots.get(&key) {
                Some(slot) => (slot.clone(), false),
                None => {
                    let slot = Arc::new(Slot {
                        value: Mutex::new(None),
                        ready: Condvar::new(),
                    });
                    slots.insert(key.clone(), slot.clone());
                    (slot, true)
                }
            }
        };
        if !leader {
            let mut value = slot.value.lock().unwrap_or_else(PoisonError::into_inner);
            loop {
                if let Some(shared) = value.as_ref() {
                    return shared.clone();
                }
                value = slot
                    .ready
                    .wait(value)
                    .unwrap_or_else(PoisonError::into_inner);
            }
        }
        let result = catch_unwind(AssertUnwindSafe(work)).unwrap_or_else(|panic| {
            let message = panic
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "The quota probe failed.".to_string());
            crashed(message)
        });
        self.slots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&key);
        *slot.value.lock().unwrap_or_else(PoisonError::into_inner) = Some(result.clone());
        slot.ready.notify_all();
        result
    }
}

/// One probe per profile at a time: two terminals on the same account ask together, and the second
/// shares the first's answer instead of running `claude /usage` twice.
pub struct QuotaService<D: ProviderDeps> {
    deps: D,
    fetching: InFlight<QuotaSnapshot>,
    waking: InFlight<WakeResult>,
}

impl<D: ProviderDeps> QuotaService<D> {
    pub fn new(deps: D) -> Self {
        Self {
            deps,
            fetching: InFlight::new(),
            waking: InFlight::new(),
        }
    }

    pub fn fetch_usage(&self, request: &FetchUsageRequest) -> QuotaSnapshot {
        let family = match (request.model_family, request.model_family_auto) {
            (Some(ModelFamily::Gemini), _) => "gemini",
            (Some(ModelFamily::Claude), _) => "claude",
            (None, true) => "auto",
            (None, false) => "",
        };
        let key = profile_key(
            request.agent,
            request.launcher.as_deref(),
            family,
            request.profile_dir.as_deref(),
        );
        let deps = &self.deps;
        let now = deps.now();
        self.fetching.run(
            key,
            || {
                let dir = request.profile_dir.as_deref();
                let launcher = request.launcher.as_deref();
                match request.agent {
                    AgentKind::Claude => fetch_claude_usage(dir, launcher, deps),
                    AgentKind::Codex => fetch_codex_usage(dir, deps).unwrap_or_else(|error| {
                        QuotaSnapshot::failure(deps.now(), QuotaError::Failed, error.to_string())
                    }),
                    AgentKind::Agy => fetch_agy_usage(dir, launcher, request.model_family, deps),
                }
            },
            |message| QuotaSnapshot::failure(now, QuotaError::Failed, message),
        )
    }

    pub fn wake(&self, request: &WakeRequest) -> WakeResult {
        let key = profile_key(
            request.agent,
            request.launcher.as_deref(),
            "",
            request.profile_dir.as_deref(),
        );
        self.waking
            .run(key, || wake_agent(request, &self.deps), WakeResult::failed)
    }

    pub fn list_profiles(&self) -> Vec<DiscoveredProfile> {
        list_profiles(&self.deps, Platform::CURRENT)
    }

    /// The scratch folder the renderer's hidden probe starts agents in: created by the service,
    /// never a path the renderer chose.
    pub fn probe_dir(&self) -> &Path {
        self.deps.tmp()
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "service_edge_tests.rs"]
mod edge_tests;
