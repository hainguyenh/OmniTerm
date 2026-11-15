//! Native features that ship inside OmniTerm and that the user can switch off from the Plugins
//! dialog (Agent Quota, Always Awake). They used to be Node plugins; they are now compiled in, so
//! only their on/off state remains plugin-like.
//!
//! The state is stored sparsely in the app settings: `disabledBuiltinFeatures` lists the ids that
//! are off, so every feature is on by default and a fresh settings file mentions none of them.

use serde_json::{json, Map, Value};

pub const AGENT_QUOTA: &str = "omniterm.agent-quota";
pub const ALWAYS_AWAKE: &str = "omniterm.always-awake";

/// The app-settings key holding the ids of the features that are switched off.
pub const SETTINGS_KEY: &str = "disabledBuiltinFeatures";

pub struct BuiltinFeature {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

pub const FEATURES: [BuiltinFeature; 2] = [
    BuiltinFeature {
        id: AGENT_QUOTA,
        name: "Agent Quota",
        description: "Shows AI agent quota per terminal, suspends an agent at its limit and wakes profiles on schedule.",
    },
    BuiltinFeature {
        id: ALWAYS_AWAKE,
        name: "Always Awake",
        description: "Keeps the Windows host awake while OmniTerm work is active.",
    },
];

pub fn find(id: &str) -> Option<&'static BuiltinFeature> {
    FEATURES.iter().find(|feature| feature.id == id)
}

fn disabled(settings: &Value) -> Vec<String> {
    settings
        .get(SETTINGS_KEY)
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .filter(|id| find(id).is_some())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Whether `id` is on. Anything unreadable in the settings counts as on, the default.
pub fn is_enabled(settings: &Value, id: &str) -> bool {
    !disabled(settings).iter().any(|off| off == id)
}

/// The settings patch that turns `id` on or off; `None` for an id that is not a built-in feature.
pub fn enabled_patch(settings: &Value, id: &str, enabled: bool) -> Option<Value> {
    find(id)?;
    let mut off: Vec<String> = disabled(settings)
        .into_iter()
        .filter(|other| other != id)
        .collect();
    if !enabled {
        off.push(id.to_string());
    }
    off.sort();
    let mut patch = Map::new();
    patch.insert(SETTINGS_KEY.to_string(), json!(off));
    Some(Value::Object(patch))
}

/// Drop the feature state from a settings patch the renderer sent. Windows save whole settings
/// objects they read earlier; a stale copy must not switch a feature back the user just toggled,
/// so only `enabled_patch` (through its own command) writes this key.
pub fn strip_patch(patch: &mut Value) {
    if let Some(fields) = patch.as_object_mut() {
        fields.remove(SETTINGS_KEY);
    }
}

/// The features as rows of the plugin list, shaped like the plugin host's descriptors.
pub fn descriptors(settings: &Value, version: &str) -> Vec<Value> {
    FEATURES
        .iter()
        .map(|feature| {
            let enabled = is_enabled(settings, feature.id);
            json!({
                "id": feature.id,
                "name": feature.name,
                "description": feature.description,
                "version": version,
                "apiVersion": 2,
                "hostVersion": version,
                "permissions": ["renderer"],
                "source": "bundled",
                "enabled": enabled,
                "status": if enabled { "loaded" } else { "disabled" },
                "activeConnectionProvider": false,
                "selectedConnectionProvider": false,
                "activeAuthProvider": false,
                "activeInvokeHandler": enabled,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "builtin_features_tests.rs"]
mod tests;
