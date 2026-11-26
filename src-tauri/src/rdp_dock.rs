//! Docking the system Remote Desktop client's session window into its pane.
//!
//! `mstsc` stays the process that owns the connection, the credential prompt and the certificate
//! warnings — OmniTerm touches no credential. Once the client shows its session window (class
//! `TscShellContainerClass`), that window is reparented into the webview window that shows the pane
//! and kept on the pane's rectangle. Without this the pane was an empty black box and the desktop
//! opened as a separate window outside the app.
//!
//! The renderer reports the pane rectangle (`rdp_set_bounds`) and visibility (`rdp_set_visible`);
//! the session's watcher thread applies them (`Docker::tick`). On platforms other than Windows the
//! client keeps its own window and the recorded rectangle only sizes the launch.

use crate::rdp_embed::RdpBounds;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

#[cfg(test)]
#[path = "rdp_dock_tests.rs"]
mod tests;

/// A pane rectangle in physical pixels, relative to the client area of the window showing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaneRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Converts the renderer's CSS-pixel rectangle to physical pixels. `None` for an empty, negative or
/// non-finite size — a hidden pane measures 0×0, and docking the client at that size collapses it.
pub fn physical_rect(bounds: &RdpBounds) -> Option<PaneRect> {
    let dpr = if bounds.dpr.is_finite() && bounds.dpr > 0.0 {
        bounds.dpr
    } else {
        1.0
    };
    let values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let scale = |v: f64| (v * dpr).round().clamp(-32_768.0, 32_767.0) as i32;
    let rect = PaneRect {
        x: scale(bounds.x),
        y: scale(bounds.y),
        width: scale(bounds.width),
        height: scale(bounds.height),
    };
    (rect.width > 0 && rect.height > 0).then_some(rect)
}

/// `mstsc` size switches for the first window. Always passed: without them the client reuses the
/// user's `Default.rdp`, which may open full screen — a window that cannot be docked into a pane.
pub fn window_size_args(rect: Option<PaneRect>) -> Vec<String> {
    let (width, height) = rect.map_or((1280, 800), |r| {
        (r.width.clamp(200, 8192), r.height.clamp(200, 8192))
    });
    vec![format!("/w:{width}"), format!("/h:{height}")]
}

/// What the renderer last asked for one RDP pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaneState {
    pub rect: Option<PaneRect>,
    pub visible: bool,
    /// The native handle of the window showing the pane, `0` until the renderer reports bounds.
    pub parent: isize,
    running: bool,
    stop: bool,
}

impl Default for PaneState {
    fn default() -> Self {
        Self {
            rect: None,
            visible: true,
            parent: 0,
            running: false,
            stop: false,
        }
    }
}

/// Pane state per RDP session id, shared by the IPC commands and the session watcher threads.
#[derive(Default)]
pub struct DockRegistry {
    panes: Mutex<HashMap<String, PaneState>>,
}

impl DockRegistry {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, PaneState>> {
        // A poisoned map still holds plain data that is valid to read and overwrite.
        self.panes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn set_bounds(&self, id: &str, rect: Option<PaneRect>, parent: isize) {
        let mut panes = self.lock();
        let pane = panes.entry(id.to_string()).or_default();
        if rect.is_some() {
            pane.rect = rect;
        }
        if parent != 0 {
            pane.parent = parent;
        }
    }

    pub fn set_visible(&self, id: &str, visible: bool) {
        self.lock().entry(id.to_string()).or_default().visible = visible;
    }

    pub fn snapshot(&self, id: &str) -> Option<PaneState> {
        self.lock().get(id).copied()
    }

    /// Marks a client as running for `id`, keeping whatever bounds the pane already reported.
    pub fn begin(&self, id: &str) {
        let mut panes = self.lock();
        let pane = panes.entry(id.to_string()).or_default();
        pane.running = true;
        pane.stop = false;
    }

    /// Asks the running client of `id` to close. A pane without a running client is forgotten.
    pub fn request_stop(&self, id: &str) {
        let mut panes = self.lock();
        match panes.get_mut(id) {
            Some(pane) if pane.running => pane.stop = true,
            _ => {
                panes.remove(id);
            }
        }
    }

    pub fn should_stop(&self, id: &str) -> bool {
        self.lock().get(id).is_some_and(|pane| pane.stop)
    }

    /// The client of `id` has exited: its pane state goes with it.
    pub fn end(&self, id: &str) {
        self.lock().remove(id);
    }
}

#[cfg(windows)]
pub use win::Docker;

#[cfg(windows)]
mod win {
    use super::{PaneRect, PaneState};
    use std::ffi::c_void;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Gdi::MapWindowPoints;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetParent, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindow, IsWindowVisible, SetParent, SetWindowLongPtrW,
        SetWindowPos, GWL_EXSTYLE, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED, SWP_HIDEWINDOW,
        SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_CAPTION, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_APPWINDOW,
        WS_EX_DLGMODALFRAME, WS_EX_WINDOWEDGE, WS_MAXIMIZE, WS_MAXIMIZEBOX, WS_MINIMIZE,
        WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };

    /// The class of the `mstsc` window that shows the remote desktop.
    const SESSION_CLASS: &str = "TscShellContainerClass";

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    /// Keeps one client's session window docked on its pane.
    pub struct Docker {
        pid: u32,
        window: Option<isize>,
    }

    impl Docker {
        pub fn new(pid: u32) -> Self {
            Self { pid, window: None }
        }

        /// Docks the session window once it is shown and keeps it on the pane. Returns `true` on
        /// the tick that docked it, so the caller can tell the renderer.
        pub fn tick(&mut self, pane: &PaneState) -> bool {
            if pane.parent == 0 {
                return false;
            }
            let parent = hwnd(pane.parent);
            // SAFETY: IsWindow accepts any handle value and only reports whether it is live.
            if let Some(raw) = self.window {
                if !unsafe { IsWindow(hwnd(raw)) }.as_bool() {
                    self.window = None;
                }
            }
            let mut docked_now = false;
            let window = match self.window {
                Some(raw) => hwnd(raw),
                None => {
                    let Some(found) = find_session_window(self.pid) else {
                        return false;
                    };
                    if pane.rect.is_none() || !dock(found, parent) {
                        return false;
                    }
                    self.window = Some(found.0 as isize);
                    docked_now = true;
                    found
                }
            };
            // SAFETY: `window` was live above; a failed call leaves it where it was.
            if unsafe { GetParent(window) }.ok() != Some(parent) && !dock(window, parent) {
                return docked_now;
            }
            if let Some(rect) = pane.rect {
                place(window, parent, rect, pane.visible);
            }
            docked_now
        }
    }

    /// The visible session window of process `pid`, if the client is showing one.
    fn find_session_window(pid: u32) -> Option<HWND> {
        struct Search {
            pid: u32,
            found: Option<HWND>,
        }
        unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
            // SAFETY: `data` is the `Search` borrowed by `find_session_window` for this call only.
            let search = unsafe { &mut *(data.0 as *mut Search) };
            let mut owner = 0u32;
            // SAFETY: `window` comes from EnumWindows; the out pointer is a local.
            unsafe { GetWindowThreadProcessId(window, Some(&mut owner)) };
            if owner != search.pid || !unsafe { IsWindowVisible(window) }.as_bool() {
                return BOOL(1);
            }
            let mut class = [0u16; 64];
            // SAFETY: the buffer outlives the call and its length bounds the write.
            let len = unsafe { GetClassNameW(window, &mut class) };
            let len = usize::try_from(len).unwrap_or(0);
            if String::from_utf16_lossy(&class[..len]) == SESSION_CLASS {
                search.found = Some(window);
                return BOOL(0);
            }
            BOOL(1)
        }
        let mut search = Search { pid, found: None };
        // SAFETY: the callback only dereferences `search`, which lives across this call. EnumWindows
        // reports an error when the callback stops early, which is how a match ends the walk.
        let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
        search.found
    }

    /// Turns the client's top-level window into a borderless child of `parent`.
    fn dock(window: HWND, parent: HWND) -> bool {
        let strip = (WS_POPUP
            | WS_CAPTION
            | WS_THICKFRAME
            | WS_SYSMENU
            | WS_MINIMIZEBOX
            | WS_MAXIMIZEBOX
            | WS_MINIMIZE
            | WS_MAXIMIZE)
            .0;
        let strip_ex = (WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_DLGMODALFRAME).0;
        // SAFETY: plain style reads and writes on a live window handle.
        unsafe {
            let style = GetWindowLongPtrW(window, GWL_STYLE) as u32;
            let style = (style & !strip) | (WS_CHILD | WS_CLIPSIBLINGS).0;
            SetWindowLongPtrW(window, GWL_STYLE, style as isize);
            let ex = GetWindowLongPtrW(window, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(window, GWL_EXSTYLE, (ex & !strip_ex) as isize);
            SetParent(window, parent).is_ok()
        }
    }

    /// Moves the docked window onto `rect` and shows or hides it, only when it is not already so —
    /// the client moves and resizes its own window while the remote desktop loads.
    fn place(window: HWND, parent: HWND, rect: PaneRect, visible: bool) {
        let mut current = RECT::default();
        // SAFETY: live handles and local out-buffers.
        let at = unsafe {
            if GetWindowRect(window, &mut current).is_err() {
                return;
            }
            let mut corners = [
                POINT {
                    x: current.left,
                    y: current.top,
                },
                POINT {
                    x: current.right,
                    y: current.bottom,
                },
            ];
            MapWindowPoints(HWND::default(), parent, &mut corners);
            PaneRect {
                x: corners[0].x,
                y: corners[0].y,
                width: corners[1].x - corners[0].x,
                height: corners[1].y - corners[0].y,
            }
        };
        // SAFETY: reads the visibility flag of a live handle.
        let shown = unsafe { IsWindowVisible(window) }.as_bool();
        if at == rect && shown == visible {
            return;
        }
        let show = if visible {
            SWP_SHOWWINDOW
        } else {
            SWP_HIDEWINDOW
        };
        // SAFETY: repositions a live child window; failure leaves it where it was.
        let _ = unsafe {
            SetWindowPos(
                window,
                HWND_TOP,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                SWP_NOACTIVATE | SWP_FRAMECHANGED | show,
            )
        };
    }
}
