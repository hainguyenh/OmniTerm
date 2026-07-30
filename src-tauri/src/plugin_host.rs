//! Rust manager for the Node.js Plugin Host Sidecar.
//!
//! Spawns Node.js with `sidecar/plugin-host.js` and manages line-delimited JSON-RPC communication
//! over stdin/stdout.

use dashmap::DashMap;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
// What the host presents — the Node->Rust capability surface and the descriptor shown when the host is
// not running — lives in plugin_host_api.rs. This file owns the process and the transport.
use crate::plugin_host_api::{disabled_descriptor, handle_reverse_call, node_arg_path};
pub struct PluginHost {
    started: AtomicBool,
    start_lock: Mutex<()>,
    next_id: AtomicU64,
    stdin_tx: Mutex<Option<mpsc::Sender<String>>>,
    pending: Arc<DashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    child: Arc<Mutex<Option<Child>>>,
    /// Why the host is not running, if it isn't. Surfaced to the user through `list_plugins` rather
    /// than only a log line: the first version returned `Ok(())` on every startup failure, so a build
    /// with no Node on PATH showed "No compatible plugins discovered" and gave no way to tell that
    /// apart from having installed none.
    disabled_reason: Mutex<Option<String>>,
}

/// Locate the sidecar entry script, or `None` if this build ships no plugin host.
///
/// Resolved against the bundled resource directory rather than `CARGO_MANIFEST_DIR`. The latter is a
/// compile-time path into the source tree, so it existed only on the machine that built the binary —
/// every packaged build silently had no plugin system at all.
pub fn resolve_sidecar_script<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(path) = app
        .path()
        .resolve("sidecar/plugin-host.cjs", BaseDirectory::Resource)
    {
        if path.exists() {
            return Some(path);
        }
    }

    // `cargo test` / `cargo run` without a bundle: fall back to the source tree so `tauri:dev` works.
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sidecar")
            .join("plugin-host.cjs");
        if dev.exists() {
            return Some(dev);
        }
    }

    None
}

/// Optional directory containing one bundled plugin or immediate plugin subdirectories.
///
/// Basic builds have no such resource. Development also stays plugin-free unless the explicit
/// `OMNITERM_DEV_PLUGIN` environment variable is supplied by `tauri:dev:full`/`:native`.
fn bundled_plugin_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("OMNITERM_DEV_PLUGIN") {
        let dir = PathBuf::from(value);
        if dir.exists() {
            return Some(dir);
        }
    }
    app.path()
        .resolve("plugins", BaseDirectory::Resource)
        .ok()
        .filter(|dir| dir.exists())
}

fn contains_installed_plugin(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| entry.path().join("package.json").is_file())
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginHost {
    pub fn new() -> Self {
        Self {
            started: AtomicBool::new(false),
            start_lock: Mutex::new(()),
            next_id: AtomicU64::new(1),
            stdin_tx: Mutex::new(None),
            pending: Arc::new(DashMap::new()),
            child: Arc::new(Mutex::new(None)),
            disabled_reason: Mutex::new(None),
        }
    }

    async fn disable(&self, reason: String) {
        log::warn!("[plugin_host] disabled: {reason}");
        *self.disabled_reason.lock().await = Some(reason);
    }

    pub async fn start<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let _start_guard = self.start_lock.lock().await;
        if self.started.load(Ordering::SeqCst) {
            return Ok(());
        }

        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data directory: {e}"))?;
        // The sidecar validates this itself and refuses a relative path; create it here so a first run
        // does not fail merely because nothing has written to app data yet.
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let installed_dir = app_data_dir.join("plugins");
        let bundled_dir = bundled_plugin_dir(app);
        if !contains_installed_plugin(&installed_dir) && bundled_dir.is_none() {
            // A plugin-free Basic build does not need Node and must not flash a plugin-host error.
            return Ok(());
        }

        let Some(sidecar_script) = resolve_sidecar_script(app) else {
            self.disable("The plugin host script is missing from this build.".to_string())
                .await;
            return Ok(());
        };

        let mut cmd = Command::new("node");
        #[cfg(windows)] cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: hide Node beside the GUI.
        // Every path handed to Node goes through `node_arg_path`: the resource directory arrives as a
        // verbatim UNC path on Windows, which Node cannot load.
        cmd.arg(node_arg_path(&sidecar_script))
            .arg(node_arg_path(&app_data_dir))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        if let Some(dir) = bundled_dir {
            cmd.arg(node_arg_path(&dir));
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                // Overwhelmingly "node is not on PATH". Say so, rather than showing the user an empty
                // plugin list they cannot distinguish from having installed nothing.
                self.disable(format!(
                    "Could not start the plugin host: {e}. Plugins need Node.js on your PATH."
                ))
                .await;
                return Ok(());
            }
        };

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
        *self.stdin_tx.lock().await = Some(stdin_tx);
        *self.child.lock().await = Some(child);

        // Stdin writer task
        tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = writer.flush().await;
            }
        });

        // Stdout reader task
        let pending = Arc::clone(&self.pending);
        let stdin_tx_ref = self.stdin_tx.lock().await.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };

                // JSON-RPC Response handling
                if let Some(id_val) = msg.get("id") {
                    if let Some(id) = id_val.as_u64() {
                        if let Some((_, tx)) = pending.remove(&id) {
                            if let Some(err) = msg.get("error") {
                                let err_msg = err
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("RPC Error")
                                    .to_string();
                                let _ = tx.send(Err(err_msg));
                            } else {
                                let result = msg.get("result").cloned().unwrap_or(Value::Null);
                                let _ = tx.send(Ok(result));
                            }
                            continue;
                        }
                    }
                }

                // Reverse calls from Node to Rust. A request carries an `id` and expects a reply; a
                // notification carries none and must not be answered. The first port required both,
                // so every notification — including `HostServices.log` — was silently dropped.
                let Some(method) = msg.get("method").and_then(Value::as_str) else {
                    continue;
                };
                let outcome = handle_reverse_call(method, msg.get("params"));
                let Some(id) = msg.get("id") else {
                    // Notification: dispatched for its side effect. There is nowhere to report a
                    // failure to, so it is dropped rather than answered.
                    continue;
                };
                let reply = match outcome {
                    Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                    // -32601 (method not found) is the closest JSON-RPC code for a host capability
                    // this build does not provide. `protocol.cjs` turns an `error` member into a
                    // rejected promise, which is the whole point: the plugin learns it failed.
                    Err(message) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": message }
                    }),
                };
                if let Some(ref tx) = stdin_tx_ref {
                    let _ = tx.send(reply.to_string()).await;
                }
            }
        });

        self.started.store(true, Ordering::SeqCst);
        log::info!("[plugin_host] Node.js plugin host process started successfully");
        Ok(())
    }

    pub async fn is_available(&self) -> bool {
        if !self.started.load(Ordering::SeqCst) {
            return false;
        }
        self.call("plugin.available", json!({})).await.unwrap_or(Value::Bool(false)).as_bool().unwrap_or(false)
    }
    pub async fn list_plugins(&self) -> Result<Vec<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            let reason = self.disabled_reason.lock().await.clone();
            return Ok(reason.map(disabled_descriptor).into_iter().collect());
        }
        let res = self.call("plugin.list", json!({})).await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    pub async fn set_enabled(&self, id: String, enabled: bool) -> Result<Value, String> {
        self.call("plugin.setEnabled", json!({ "id": id, "enabled": enabled })).await
    }

    pub async fn select_connection_provider(&self, id: Option<String>) -> Result<Vec<Value>, String> {
        let res = self
            .call("plugin.selectConnectionProvider", json!({ "id": id }))
            .await?;
        serde_json::from_value(res).map_err(|e| e.to_string())
    }

    pub async fn connection_capabilities(&self) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self.call("connections.capabilities", json!({})).await?;
        Ok((!res.is_null()).then_some(res))
    }

    // Deliberately no `install`. Copying a caller-supplied directory in and `require`-ing it is code
    // execution, and nothing that reaches the webview may decide to do it. Installation happens out of
    // band (`pnpm install:plugin <dir>`); discovery at startup is what picks the result up.

    pub async fn uninstall(&self, id: String) -> Result<bool, String> {
        let res = self.call("plugin.uninstall", json!({ "id": id })).await?;
        Ok(res.as_bool().unwrap_or(true))
    }

    pub async fn invoke(&self, method: String, args: Vec<Value>) -> Result<Value, String> {
        self.call("plugin.invoke", json!({ "method": method, "args": args })).await
    }

    pub async fn auth_gate(&self) -> Result<bool, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(true);
        }
        let res = self.call("plugin.authGate", json!({})).await?;
        Ok(res.as_bool().unwrap_or(true))
    }

    pub async fn load_connections(&self) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self.call("connections.load", json!({})).await?;
        if res.is_null() {
            Ok(None)
        } else {
            Ok(Some(res))
        }
    }

    pub async fn save_connections(&self, data: Value) -> Result<bool, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let res = self.call("connections.save", json!({ "data": data })).await?;
        Ok(res.as_bool().unwrap_or(false))
    }

    pub async fn resolve_connection(&self, conn_id: String) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self.call("connections.resolve", json!({ "connId": conn_id })).await?;
        if res.is_null() {
            Ok(None)
        } else {
            Ok(Some(res))
        }
    }

    pub async fn load_scoped_connections(&self, scope: Value) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self.call("connections.loadScoped", json!({ "scope": scope })).await?;
        Ok((!res.is_null()).then_some(res))
    }

    pub async fn save_scoped_connections(&self, scope: Value, data: Value) -> Result<bool, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let res = self
            .call("connections.saveScoped", json!({ "scope": scope, "data": data }))
            .await?;
        Ok(res.as_bool().unwrap_or(false))
    }

    pub async fn resolve_scoped_connection(
        &self,
        scope: Value,
        conn_id: String,
    ) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self
            .call(
                "connections.resolveScoped",
                json!({ "scope": scope, "connId": conn_id }),
            )
            .await?;
        Ok((!res.is_null()).then_some(res))
    }

    pub async fn resolve_connection_launch(
        &self,
        scope: Value,
        conn_id: String,
    ) -> Result<Option<Value>, String> {
        if !self.started.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let res = self
            .call(
                "connections.resolveLaunch",
                json!({ "scope": scope, "connId": conn_id }),
            )
            .await?;
        Ok((!res.is_null()).then_some(res))
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);

        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let line = req.to_string();
        let sender = {
            let tx_guard = self.stdin_tx.lock().await;
            tx_guard.clone()
        };

        let Some(sender) = sender else {
            self.pending.remove(&id);
            return Err("Plugin host process not running".to_string());
        };

        sender.send(line).await.map_err(|e| e.to_string())?;

        rx.await.map_err(|_| "Plugin host response channel dropped".to_string())?
    }
}
