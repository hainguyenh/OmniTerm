//! Backend to webview event bus: every `ide-*` crate emits through an `EventSink`; this one forwards
//! to all windows as the single `ide://event` Tauri event.

use ide_core::{EventSink, IdeEvent};
use tauri::{AppHandle, Emitter, Runtime};

/// Name of the one backend event. The payload is an `IdeEvent`.
pub const IDE_EVENT: &str = "ide://event";

pub struct TauriSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriSink<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> EventSink for TauriSink<R> {
    fn emit(&self, event: IdeEvent) {
        if let Err(error) = self.app.emit(IDE_EVENT, &event) {
            log::warn!("could not deliver an IDE event: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;

    #[test]
    fn events_reach_the_webview_listener_under_the_ide_event_name() {
        let app = crate::test_support::mock_app();
        let (sender, receiver) = std::sync::mpsc::channel();
        app.handle().listen(IDE_EVENT, move |event| {
            let _ = sender.send(event.payload().to_string());
        });

        TauriSink::new(app.handle().clone()).emit(IdeEvent::WindowGroupsChanged);

        let payload = receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("event delivered");
        assert_eq!(payload, r#"{"type":"windowGroupsChanged"}"#);
    }
}
