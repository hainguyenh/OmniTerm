//! OmniTerm core: domain logic + IO services.
//!
//! No Tauri dependency lives here. The desktop adapter (`src-tauri/`) links
//! this crate directly and supplies Tauri-bound wrappers around any
//! behavior that needs the host runtime.

pub mod launch;
pub mod proc_activity;
pub mod rdp_launch;
pub mod safepath;
pub mod tree_validate;
#[cfg(windows)]
pub mod win_job;
pub mod workspace_launch;
pub mod workspace_model;
pub mod workspace_scan;

#[cfg(test)]
mod test_support;