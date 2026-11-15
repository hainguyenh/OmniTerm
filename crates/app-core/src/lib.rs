//! OmniTerm core: domain logic + IO services.
//!
//! No Tauri dependency lives here. The desktop adapter (`src-tauri/`) links
//! this crate directly and supplies Tauri-bound wrappers around any
//! behavior that needs the host runtime.

pub mod agent_model;
pub mod agent_quota;
pub mod agent_session_header;
pub mod agent_session_index;
pub mod agent_sessions;
pub mod attachments;
pub mod builtin_features;
pub mod claude_transcript;
pub mod ide_paths;
pub mod launch;
pub mod proc_activity;
pub mod rdp_launch;
pub mod safepath;
pub mod temp_notes;
pub mod tree_validate;
#[cfg(windows)]
pub mod win_job;
pub mod workspace_fs;
pub mod workspace_launch;
pub mod workspace_model;
pub mod workspace_scan;

#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
#[cfg(test)]
mod test_support;
