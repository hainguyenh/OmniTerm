//! Paths of files dropped from the OS onto the main window.
//!
//! The main window turns the webview's own drag-drop handler off (`dragDropEnabled: false` in
//! tauri.conf.json): with it on, WebView2 swallows the page's HTML5 drags and pane headers can no
//! longer be dragged. The page then receives an OS drop as HTML5 `File`s, which carry no path. It
//! hands them back with `chrome.webview.postMessageWithAdditionalObjects`, WebView2's way to give
//! the host a dropped file's path, and this module answers with the paths as a window event.
//!
//! The page posts a string (`{"omnitermFileDrop":<token>}` as JSON text), never an object. WebView2
//! calls the message handlers in the order they were added and stops at the first one that fails;
//! wry's handler, added with the webview, fails on any message that is not a string, so an object
//! never reached this module's handler and a dropped file never opened. A string passes wry, which
//! hands it to Tauri's IPC; Tauri cannot read it as a command and logs one `console.error` in the
//! page, which is harmless.

use serde::Serialize;

/// The event the page receives, with the paths of one drop.
pub(crate) const EVENT: &str = "omniterm:native-file-drop";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct DroppedPaths {
    /// The page's number for the drop, which tells it where the files were dropped.
    pub token: u64,
    pub paths: Vec<String>,
}

/// The drop token of a page message (its string, holding JSON), or `None` for any other message.
pub(crate) fn drop_token(message: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(message)
        .ok()?
        .get("omnitermFileDrop")?
        .as_u64()
}

/// Starts answering the page's dropped-file messages in `window`.
#[cfg(windows)]
pub(crate) fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let target = window.clone();
    let installed = window.with_webview(move |webview| {
        if let Err(error) = webview2::listen(&webview, target) {
            log::warn!("[file-drop] cannot read the paths of dropped files: {error}");
        }
    });
    if let Err(error) = installed {
        log::warn!("[file-drop] cannot reach the main webview: {error}");
    }
}

/// Other platforms keep the webview's HTML5 drops without paths; nothing to install.
#[cfg(not(windows))]
pub(crate) fn install<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg(windows)]
mod webview2 {
    use tauri::{Emitter, EventTarget, Runtime, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs,
        ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows_core::{Interface, PWSTR};

    use super::{drop_token, DroppedPaths, EVENT};

    pub(super) fn listen<R: Runtime>(
        webview: &tauri::webview::PlatformWebview,
        window: WebviewWindow<R>,
    ) -> windows_core::Result<()> {
        // SAFETY: `with_webview` runs this on the main thread with the window's live controller.
        let core = unsafe { webview.controller().CoreWebView2()? };
        let label = window.label().to_owned();
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            // Never fail: a failing handler stops WebView2 from calling the ones added after it.
            match dropped_paths(&args) {
                Ok(Some(dropped)) => {
                    let target = EventTarget::webview_window(label.as_str());
                    if let Err(error) = window.emit_to(target, EVENT, dropped) {
                        log::warn!(
                            "[file-drop] cannot pass dropped file paths to the page: {error}"
                        );
                    }
                }
                Ok(None) => {}
                Err(error) => log::warn!("[file-drop] cannot read the dropped files: {error}"),
            }
            Ok(())
        }));
        let mut token = 0;
        // SAFETY: the handler is a valid COM object; WebView2 keeps its own reference to it.
        unsafe { core.add_WebMessageReceived(&handler, &mut token) }
    }

    /// The paths of a drop message, or `None` for every other message the page posts.
    fn dropped_paths(
        args: &ICoreWebView2WebMessageReceivedEventArgs,
    ) -> windows_core::Result<Option<DroppedPaths>> {
        let mut message = PWSTR::null();
        // SAFETY: `message` receives a CoTaskMem string that `take_pwstr` frees. A message that is
        // not a string (fails here) is not a drop.
        if unsafe { args.TryGetWebMessageAsString(&mut message) }.is_err() {
            return Ok(None);
        }
        let Some(token) = drop_token(&take_pwstr(message)) else {
            return Ok(None);
        };
        // SAFETY: plain COM calls on interfaces WebView2 handed to this callback.
        let objects = unsafe {
            args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>()?
                .AdditionalObjects()?
        };
        let mut count = 0u32;
        unsafe { objects.Count(&mut count)? };
        let mut paths = Vec::new();
        for index in 0..count {
            // Anything but a file (the page sends only files) is skipped.
            let Ok(file) = unsafe { objects.GetValueAtIndex(index) }
                .and_then(|object| object.cast::<ICoreWebView2File>())
            else {
                continue;
            };
            let mut path = PWSTR::null();
            if unsafe { file.Path(&mut path) }.is_ok() {
                paths.push(take_pwstr(path));
            }
        }
        Ok(Some(DroppedPaths { token, paths }))
    }
}

#[cfg(test)]
mod tests {
    use super::drop_token;

    #[test]
    fn reads_the_token_of_a_drop_message_only() {
        assert_eq!(drop_token(r#"{"omnitermFileDrop":7}"#), Some(7));
        assert_eq!(drop_token(r#"{"cmd":"plugin:event|listen"}"#), None);
        assert_eq!(drop_token(r#""omnitermFileDrop""#), None);
        assert_eq!(drop_token(r#"{"omnitermFileDrop":"7"}"#), None);
        assert_eq!(drop_token("not json"), None);
    }
}
