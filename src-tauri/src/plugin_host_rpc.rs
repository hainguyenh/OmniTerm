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
