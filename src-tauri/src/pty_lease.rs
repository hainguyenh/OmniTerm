use session_core::SessionDaemonClient;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

pub(crate) fn ensure(
    client_slot: &OnceLock<SessionDaemonClient>,
    lease_started: &AtomicBool,
    shutdown_requested: &Arc<AtomicBool>,
) {
    if shutdown_requested.load(Ordering::Acquire) {
        return;
    }
    if lease_started.swap(true, Ordering::AcqRel) {
        return;
    }
    let Some(client) = client_slot.get().cloned() else {
        lease_started.store(false, Ordering::Release);
        return;
    };
    let shutdown_requested = Arc::clone(shutdown_requested);
    tauri::async_runtime::spawn(async move {
        // Exponential backoff between lease attempts. A daemon that is up
        // re-accepts instantly (failures reset), but a dead or uninstallable
        // daemon must not be hammered with connect/spawn attempts at 4 Hz.
        const BASE_RETRY_MS: u64 = 250;
        const MAX_BACKOFF_SHIFT: u32 = 5; // 250ms * 2^5 = 8s ceiling
        let mut failures: u32 = 0;
        loop {
            if shutdown_requested.load(Ordering::Acquire) {
                break;
            }
            match client.hold_lease().await {
                Ok(()) => failures = 0,
                Err(error) => {
                    failures = failures.saturating_add(1);
                    log::debug!("[sessiond] client lease ended: {error}");
                }
            }
            if shutdown_requested.load(Ordering::Acquire) {
                break;
            }
            let delay = BASE_RETRY_MS << failures.min(MAX_BACKOFF_SHIFT);
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        }
    });
}
