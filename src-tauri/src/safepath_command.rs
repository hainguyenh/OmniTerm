//! Thin Tauri command wrapper around `app_core::safepath::VIEW_DENY_EXTS`.
//!
//! The allow/deny lists and containment functions live in `app-core` where they can be tested
//! without a Tauri runtime. This module is just the single `#[tauri::command]` the desktop
//! adapter exposes to the frontend.

#[tauri::command]
pub fn system_excluded_view_exts() -> Vec<String> {
    app_core::safepath::VIEW_DENY_EXTS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_excluded_view_exts_matches_the_viewer_deny_list() {
        let excluded = system_excluded_view_exts();
        assert_eq!(
            excluded.iter().map(String::as_str).collect::<Vec<_>>(),
            app_core::safepath::VIEW_DENY_EXTS.to_vec(),
            "the Settings UI and the viewer must source the same deny-list"
        );
        assert!(
            !excluded.is_empty(),
            "the deny-list is non-empty in production"
        );
    }
}
