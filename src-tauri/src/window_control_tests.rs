use super::*;
use crate::test_support;

// `Manager::get_window` is `unstable`-feature-gated, and `WebviewWindow`'s inner `Window` field is
// crate-private — so a plain `Window<R>` for the non-webview commands is pulled out via
// `Webview::window()` instead, the same public path `WebviewWindow::window_ref()`-less code uses.
fn mock_window(app: &tauri::App<tauri::test::MockRuntime>, label: &str) -> Window<tauri::test::MockRuntime> {
    let webview_window = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .build()
        .expect("build a mock webview window");
    AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&webview_window).window()
}

#[test]
fn minimize_close_and_is_maximized_round_trip_through_a_mock_window() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let window = mock_window(&app, "test-window");

    assert!(tauri::async_runtime::block_on(minimize_window(window.clone())).is_ok());

    // MockRuntime's dispatcher always reports `false`, regardless of maximize/unmaximize calls —
    // there is no tracked state behind it, so this only ever exercises the "not maximized" branch.
    assert!(!tauri::async_runtime::block_on(is_maximized(window.clone())).unwrap());

    assert!(tauri::async_runtime::block_on(close_window(window)).is_ok());
}

#[test]
fn toggle_maximize_takes_the_maximize_branch_when_not_already_maximized() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let window = mock_window(&app, "toggle-window");

    assert!(tauri::async_runtime::block_on(toggle_maximize(window)).is_ok());
}

#[test]
fn set_webview_zoom_accepts_a_mock_webview_window() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let window = tauri::WebviewWindowBuilder::new(&app, "zoom-window", tauri::WebviewUrl::App("index.html".into()))
        .build()
        .expect("build a mock webview window");

    assert!(tauri::async_runtime::block_on(set_webview_zoom(window, 1.5)).is_ok());
}

#[test]
fn test_toggle_maximize_when_maximized() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let _window = mock_window(&app, "toggle-window-2");
    // MockRuntime doesn't track maximized state, so is_maximized always returns false.
    // But wait! How do we make it return true?
}
