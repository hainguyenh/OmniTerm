//! Host capabilities a plugin may call back into (the Node→Rust half of the sidecar protocol).
//!
//! Split from plugin_host.rs, which owns the process and the transport. This file is only the policy:
//! what a plugin is allowed to ask the host to do. Keeping it separate means the answer to "can a
//! plugin make the host do X" is one short file, not buried in spawn and framing code.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "plugin_host_api_tests.rs"]
mod tests;

/// Rewrite a path into a form Node.js can actually load.
///
/// Tauri resolves `BaseDirectory::Resource` by canonicalizing the executable's directory, and on
/// Windows that yields a *verbatim* UNC path — `\\?\D:\...`. Rust and the Win32 API accept it; Node
/// does not. Its `realpathSync` reads `\\?\` as the whole root and then `lstat`s the next segment,
/// `D:`, which fails `EISDIR` — so passing the resolved path straight to `node` made the sidecar die
/// on startup in every build where the resource directory was used, i.e. every packaged build and
/// `tauri:dev`. The prefix is only an escape hatch for long/odd paths, so dropping it loses nothing
/// at the lengths involved here.
///
/// `\\?\UNC\server\share` is left intact: the prefix is load-bearing there, and stripping it would
/// produce `UNC\server\share`, which is not a path at all.
pub fn node_arg_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        // Drive-letter form only: `X:` followed by a separator.
        if rest.as_bytes().get(1) == Some(&b':') {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

/// A `PluginDescriptor` reporting that the plugin host itself did not start.
///
/// Returned instead of an empty plugin list so the reason reaches the Plugins panel, which already
/// renders `error` for any descriptor. Without it, a machine with no Node.js on PATH showed
/// "No compatible plugins discovered" — indistinguishable from having installed none. Never `enabled`,
/// so nothing tries to toggle or invoke it.
pub fn disabled_descriptor(reason: String) -> Value {
    json!({
        "id": "omniterm.plugin-host",
        "name": "Plugin host",
        "version": env!("CARGO_PKG_VERSION"),
        "apiVersion": 2,
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "permissions": [],
        "source": "bundled",
        "enabled": false,
        "status": "error",
        "error": reason,
        "activeConnectionProvider": false,
        "selectedConnectionProvider": false,
        "activeAuthProvider": false,
        "activeInvokeHandler": false,
    })
}

/// Dispatch a reverse call, returning `Err` for anything this build does not implement.
pub fn handle_reverse_call(method: &str, params: Option<&Value>) -> Result<Value, String> {
    match method {
        "host.openExternal" => {
            let url = params
                .and_then(|p| p.get("url"))
                .and_then(Value::as_str)
                .ok_or("host.openExternal requires a string \"url\"")?;
            // Never `opener::open` a plugin-supplied string directly: that is arbitrary program
            // execution via whatever handler the OS associates with the scheme.
            if !crate::app_utils::is_allowed_plugin_url(url) {
                return Err("refused: only https URLs without embedded credentials".to_string());
            }
            opener::open(url).map_err(|e| e.to_string())?;
            Ok(Value::Bool(true))
        }
        "host.log" => {
            if let Some(msg) = params.and_then(|p| p.get("message")).and_then(Value::as_str) {
                log::info!("[plugin] {msg}");
            }
            Ok(Value::Bool(true))
        }
        _ => Err(format!("unknown host method \"{method}\"")),
    }
}
