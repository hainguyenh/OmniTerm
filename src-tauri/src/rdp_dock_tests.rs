use super::*;

fn bounds(x: f64, y: f64, width: f64, height: f64, dpr: f64) -> RdpBounds {
    RdpBounds {
        x,
        y,
        width,
        height,
        dpr,
    }
}

#[test]
fn physical_rect_scales_css_pixels_by_the_device_pixel_ratio() {
    assert_eq!(
        physical_rect(&bounds(10.0, 20.5, 300.0, 200.0, 1.5)),
        Some(PaneRect {
            x: 15,
            y: 31,
            width: 450,
            height: 300,
        })
    );
    // A missing or broken ratio counts as 1.
    assert_eq!(
        physical_rect(&bounds(1.0, 2.0, 3.0, 4.0, 0.0)),
        Some(PaneRect {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
        })
    );
}

#[test]
fn physical_rect_refuses_a_hidden_or_broken_pane() {
    assert_eq!(physical_rect(&bounds(0.0, 0.0, 0.0, 100.0, 1.0)), None);
    assert_eq!(physical_rect(&bounds(0.0, 0.0, 100.0, -5.0, 1.0)), None);
    assert_eq!(
        physical_rect(&bounds(f64::NAN, 0.0, 100.0, 100.0, 1.0)),
        None
    );
    assert_eq!(
        physical_rect(&bounds(0.0, 0.0, f64::INFINITY, 100.0, 1.0)),
        None
    );
}

/// Regression: without explicit size switches `mstsc /v:` reuses `Default.rdp`, which may open full
/// screen instead of a window that can be docked into the pane.
#[test]
fn window_size_args_always_ask_for_a_window() {
    assert_eq!(window_size_args(None), vec!["/w:1280", "/h:800"]);
    let pane = PaneRect {
        x: 0,
        y: 0,
        width: 1000,
        height: 50,
    };
    assert_eq!(window_size_args(Some(pane)), vec!["/w:1000", "/h:200"]);
}

#[test]
fn registry_keeps_bounds_reported_before_the_client_starts() {
    let registry = DockRegistry::default();
    let rect = PaneRect {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
    };
    registry.set_bounds("rdp", Some(rect), 42);
    registry.set_visible("rdp", false);
    registry.begin("rdp");
    // A later report without a measurable rect or window keeps what is known.
    registry.set_bounds("rdp", None, 0);
    let pane = registry.snapshot("rdp").expect("pane state");
    assert_eq!(pane.rect, Some(rect));
    assert_eq!(pane.parent, 42);
    assert!(!pane.visible);
    assert!(!registry.should_stop("rdp"));
}

/// Closing the pane closes the docked client: otherwise the session window would stay inside the
/// app with no pane around it.
#[test]
fn request_stop_reaches_a_running_client_and_forgets_an_idle_pane() {
    let registry = DockRegistry::default();
    registry.begin("running");
    registry.request_stop("running");
    assert!(registry.should_stop("running"));
    registry.end("running");
    assert_eq!(registry.snapshot("running"), None);

    registry.set_visible("idle", true);
    registry.request_stop("idle");
    assert_eq!(registry.snapshot("idle"), None);
    assert!(!registry.should_stop("idle"));
}
