//! JSON-RPC facade for the plugin host transport.

use super::*;
use crate::plugin_host_api::disabled_descriptor;

impl PluginHost {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn stopped_host_returns_safe_fallbacks_for_every_optional_provider_call() {
        let host = PluginHost::new();
        assert!(!block_on(host.is_available()));
        assert!(block_on(host.list_plugins()).unwrap().is_empty());
        assert_eq!(block_on(host.connection_capabilities()).unwrap(), None);
        assert!(block_on(host.auth_gate()).unwrap());
        assert_eq!(block_on(host.load_connections()).unwrap(), None);
        assert!(!block_on(host.save_connections(json!([]))).unwrap());
        assert_eq!(block_on(host.resolve_connection("x".to_string())).unwrap(), None);
        assert_eq!(block_on(host.load_scoped_connections(json!({}))).unwrap(), None);
        assert!(!block_on(host.save_scoped_connections(json!({}), json!([]))).unwrap());
        assert_eq!(
            block_on(host.resolve_scoped_connection(json!({}), "x".to_string())).unwrap(),
            None
        );
        assert_eq!(
            block_on(host.resolve_connection_launch(json!({}), "x".to_string())).unwrap(),
            None
        );
    }

    #[test]
    fn disabled_reason_is_exposed_as_a_descriptor() {
        let host = PluginHost::new();
        block_on(host.disable("Node missing".to_string()));
        let plugins = block_on(host.list_plugins()).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["id"], "omniterm.plugin-host");
        assert_eq!(plugins[0]["error"], "Node missing");
    }

    #[test]
    fn started_host_without_transport_fails_every_rpc_and_cleans_pending_requests() {
        let host = PluginHost::new();
        host.started.store(true, Ordering::SeqCst);

        assert!(!block_on(host.is_available()));
        assert!(block_on(host.list_plugins()).is_err());
        assert!(block_on(host.set_enabled("x".to_string(), true)).is_err());
        assert!(block_on(host.select_connection_provider(Some("x".to_string()))).is_err());
        assert!(block_on(host.connection_capabilities()).is_err());
        assert!(block_on(host.uninstall("x".to_string())).is_err());
        assert!(block_on(host.invoke("method".to_string(), vec![json!(1)])).is_err());
        assert!(block_on(host.auth_gate()).is_err());
        assert!(block_on(host.load_connections()).is_err());
        assert!(block_on(host.save_connections(json!([]))).is_err());
        assert!(block_on(host.resolve_connection("x".to_string())).is_err());
        assert!(block_on(host.load_scoped_connections(json!({}))).is_err());
        assert!(block_on(host.save_scoped_connections(json!({}), json!([]))).is_err());
        assert!(block_on(host.resolve_scoped_connection(json!({}), "x".to_string())).is_err());
        assert!(block_on(host.resolve_connection_launch(json!({}), "x".to_string())).is_err());
        assert!(host.pending.is_empty());
        assert!(host.next_id.load(Ordering::SeqCst) > 1);
    }

    /// `call()`'s real success path — send on `stdin_tx`, await the reply on the `pending` oneshot —
    /// is otherwise never exercised: every other test only ever hits the "not started"/"no sender"
    /// fallbacks. This substitutes a channel-backed fake transport for the real Node sidecar, playing
    /// the part of `PluginHost::start`'s stdout-reader task: parse the request line, resolve the
    /// matching `pending` entry, and reply.
    #[test]
    fn call_round_trips_through_a_real_channel_transport() {
        let host = PluginHost::new();
        host.started.store(true, Ordering::SeqCst);

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(8);
        block_on(async {
            *host.stdin_tx.lock().await = Some(stdin_tx);
        });

        let pending = Arc::clone(&host.pending);
        tauri::async_runtime::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                let msg: Value = serde_json::from_str(&line).expect("a well-formed JSON-RPC request");
                let id = msg["id"].as_u64().expect("request should carry a numeric id");
                if let Some((_, tx)) = pending.remove(&id) {
                    let _ = tx.send(Ok(json!({ "echoedMethod": msg["method"] })));
                }
            }
        });

        let result = block_on(host.invoke("ping".to_string(), vec![json!(1)])).unwrap();
        assert_eq!(result, json!({ "echoedMethod": "plugin.invoke" }));
    }
}
