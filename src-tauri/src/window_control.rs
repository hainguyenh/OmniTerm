use tauri::{Runtime, WebviewWindow, Window};

#[cfg(test)]
#[path = "window_control_tests.rs"]
mod tests;

#[tauri::command]
pub async fn minimize_window<R: Runtime>(window: Window<R>) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Real WebView zoom (WebView2/WebKit), not a CSS `zoom` on `<body>` — it reflows the layout and
/// stays anchored, instead of scaling from the top-left and clipping against `h-screen`/`w-screen`.
#[tauri::command]
pub async fn set_webview_zoom<R: Runtime>(window: WebviewWindow<R>, factor: f64) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_maximize<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_window<R: Runtime>(window: Window<R>) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_maximized<R: Runtime>(window: Window<R>) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}
